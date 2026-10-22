"""Durable event journal. Commit before SSE delivery; reads never replay side effects."""
import hashlib
import json
import re
import uuid
from datetime import datetime, timezone

import anyio
from sqlalchemy import select, func

from database import SessionLocal
from models import ExecutionLog, RunRecord, RunEvent, RunArtifact
from studio_copilot.redaction import redact


def redact_value(value):
    """Reuse all shipped secret patterns, including provider project keys."""
    if isinstance(value, str):
        safe = redact(value)[0]
        # An interrupted provider may leave an unfinished PEM block.
        return re.sub(r'-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*', '[redacted:private_key]', safe)
    if isinstance(value, dict):
        return {redact(str(key))[0]: '[redacted:credential]' if str(key).lower() in
                {'password', 'secret', 'api_key', 'apikey', 'api-key', 'authorization', 'access_token', 'token'}
                else redact_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [redact_value(item) for item in value]
    return value


def now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def metadata(record):
    return {'coverage': record.coverage if record else 'legacy_unknown',
            'last_sequence': record.last_sequence if record else None,
            'schema_version': record.schema_version if record else None}


def event_view(event):
    return {'sequence': event.sequence, 'event': event.event_type,
            'schema_version': event.schema_version, 'data': json.loads(event.data_json),
            'created_at': event.created_at.isoformat()}


def artifact_view(artifact, *, content=False):
    result = {key: getattr(artifact, key) for key in
              ('id', 'run_id', 'event_sequence', 'kind', 'name', 'version', 'media_type', 'sha256')}
    if content:
        result['content'] = json.loads(artifact.content_json)
    return result


class RunWriter:
    """One writer per execution. Sequence allocation is committed with each event."""
    def __init__(self, run_id):
        self.run_id = run_id
        self.sequence = 0

    async def append(self, event):
        safe = redact_value(event)
        sequence = self.sequence + 1
        # Disconnect may cancel the response scope halfway through a commit.
        with anyio.CancelScope(shield=True):
            async with SessionLocal() as db:
                record = await db.get(RunRecord, self.run_id)
                if record is None or record.last_sequence != self.sequence:
                    raise RuntimeError('Run journal sequence conflict')
                db.add(RunEvent(run_id=self.run_id, sequence=sequence,
                                event_type=safe['event'], data_json=json.dumps(safe['data'])))
                data = safe['data']
                kind = {'node_done': 'node_output', 'tool_result': 'tool_result'}.get(safe['event'])
                if kind:
                    content = data.get('output', '') if kind == 'node_output' else data.get('result', data)
                    name = f"{kind}:{data.get('node_id', '')}:{data.get('name', data.get('call_id', ''))}"
                    version = (await db.scalar(select(func.max(RunArtifact.version)).where(
                        RunArtifact.run_id == self.run_id, RunArtifact.name == name)) or 0) + 1
                    encoded = json.dumps(content, ensure_ascii=False)
                    db.add(RunArtifact(
                        id=str(uuid.uuid5(uuid.NAMESPACE_URL, f'{self.run_id}/{sequence}/{kind}')),
                        run_id=self.run_id, event_sequence=sequence, kind=kind, name=name,
                        version=version, media_type='text/plain' if isinstance(content, str) else 'application/json',
                        content_json=encoded, sha256=hashlib.sha256(encoded.encode()).hexdigest()))
                record.last_sequence = sequence
                if safe['event'] == 'harness_done':
                    record.coverage = 'complete'
                    log = await db.get(ExecutionLog, self.run_id)
                    status = data.get('status', 'error')
                    log.status = 'failed' if record.source == 'direct' and status == 'error' else status
                    log.finished_at = now()
                await db.commit()
        self.sequence = sequence
        return safe

    async def finish(self, status):
        with anyio.CancelScope(shield=True):
            async with SessionLocal() as db:
                log = await db.get(ExecutionLog, self.run_id)
                record = await db.get(RunRecord, self.run_id)
                if record.coverage != 'complete':
                    log.status = ('interrupted' if status == 'complete' else
                                  'failed' if record.source == 'direct' and status == 'error' else status)
                    log.finished_at = now()
                await db.commit()


_PREFIXES = ('sk-', 'AIza', 'AKIA', 'ghp_', 'xox', '-----BEGIN',
             'api_key', 'api-key', 'apikey', 'token', 'secret', 'password')
_CANDIDATE = re.compile('|'.join(re.escape(p) for p in _PREFIXES), re.IGNORECASE)


def stream_cutoff(text):
    """Release ordinary text immediately; retain only possible credentials.

    Candidates have no fixed length: PEM and assignment whitespace can span
    lines. A partial prefix at a chunk boundary must also remain uncommitted.
    """
    cut = len(text)
    for match in _CANDIDATE.finditer(text):
        prefix = match.group().lower()
        rest = text[match.end():]
        if prefix == '-----begin':
            incomplete = not re.search(r'-----END [A-Z ]*PRIVATE KEY-----', rest)
        elif prefix in ('api_key', 'api-key', 'apikey', 'token', 'secret', 'password'):
            assignment = re.match(r'''["']?\s*[=:]\s*["']?''', rest)
            if assignment:
                value = rest[assignment.end():]
                incomplete = not re.search(r'[\s,}]', value)
            else:
                incomplete = bool(re.fullmatch(r'''["']?\s*''', rest))
        else:
            incomplete = not re.search(r'[^A-Za-z0-9_-]', rest)
        if incomplete:
            cut = min(cut, match.start())
    lower = text.lower()
    for prefix in _PREFIXES:
        for length in range(1, len(prefix)):
            if lower.endswith(prefix[:length].lower()):
                cut = min(cut, len(text) - length)
    return cut


async def journal_stream(stream, writer, parse, sse):
    """Persist and deliver the same sanitized event, buffering secret candidates."""
    pending = {}
    contexts = {}  # Short prefixes already emitted across a change of event type.
    last_key = None

    def drain(key, *, barrier=False):
        event, node_id = key
        context = contexts.pop(key, '')
        raw = context + pending.pop(key, '')
        text = redact_value(raw)
        cut = stream_cutoff(raw)
        if cut < len(raw):
            if text == raw and _CANDIDATE.match(raw[cut:]):
                text = raw[:cut] + '[redacted:incomplete_credential]'
            if barrier:
                # Remember both harmless prefixes and suppressed candidates:
                # a tool/phase event must not expose a subsequent secret body.
                contexts[key] = raw[cut:]
        if context and text.startswith(context):
            text = text[len(context):]
        return {'event': event, 'data': {'node_id': node_id, 'chunk': text}}

    try:
        async for chunk in stream:
            event = parse(chunk)
            if event is None:
                continue
            name, data = event['event'], event['data']
            key = (name, data.get('node_id', '')) if name in ('node_stream', 'node_reason') else None
            batch = []
            if last_key is not None and last_key != key and pending.get(last_key):
                batch.append(drain(last_key, barrier=True))
            if key is not None:
                context = contexts.get(key, '')
                text = context + pending.get(key, '') + data.get('chunk', '')
                cut = stream_cutoff(text)
                if cut < len(context):
                    pending[key] = text[len(context):]
                    output = ''
                else:
                    output = redact_value(text[:cut])
                    if context and output.startswith(context):
                        output = output[len(context):]
                    contexts.pop(key, None)
                    pending[key] = text[cut:]
                batch.append({'event': name, 'data': {**data, 'chunk': output}})
            else:
                if name in ('node_done', 'node_error', 'harness_done', 'error', 'run_stopped'):
                    batch.extend(drain(k) for k in list(pending) if pending[k])
                    contexts.clear()
                batch.append(event)
            last_key = key
            for item in batch:
                safe = await writer.append(item)
                yield sse(safe['event'], safe['data'])
    finally:
        try:
            await stream.aclose()
        finally:
            # Graceful disconnects retain a trailing ordinary prefix too. A hard
            # kill can lose only an uncommitted candidate, never delivered text.
            for key in list(pending):
                if pending[key]:
                    await writer.append(drain(key))


async def recover_interrupted():
    """Single sidecar startup: a previous process cannot still own these runs."""
    async with SessionLocal() as db:
        logs = (await db.scalars(select(ExecutionLog).where(ExecutionLog.status == 'running'))).all()
        for log in logs:
            log.status = 'interrupted'
            log.finished_at = now()
        await db.commit()
