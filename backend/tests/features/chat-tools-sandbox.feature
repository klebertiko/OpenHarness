Feature: Chat tools sandbox — read stays inside the authorized workspace
  Contract: contract.md §2.3, §4. Owner BE: Codex (pytest-bdd). Owner FE: Claude (Vitest, same scenario names).

  Background:
    Given a Cowork project registered with rootPath "<tmp>/ws"
    And the sidecar token header is present

  Scenario: Read a text file inside the root
    When I POST /chat/tools/read with path "docs/README.md"
    Then the status is 200
    And the response path is "docs/README.md"
    And the content equals the file on disk

  Scenario: Traversal with dot-dot is refused
    When I POST /chat/tools/read with path "../outside.txt"
    Then the status is 403
    And the error is "path_escapes_root"
    And the response contains no file content

  Scenario: Absolute path outside the root is refused
    When I POST /chat/tools/read with path "<tmp>/outside.txt"
    Then the status is 403
    And the error is "path_escapes_root"

  Scenario: Symlink inside the root pointing outside is refused after resolution
    Given "<tmp>/ws/link" is a symlink to "<tmp>/outside-dir"
    When I POST /chat/tools/read with path "link/secret.txt"
    Then the status is 403
    And the error is "symlink_escapes_root"

  Scenario: Symlink inside the root pointing inside is allowed
    Given "<tmp>/ws/alias" is a symlink to "<tmp>/ws/docs"
    When I POST /chat/tools/read with path "alias/README.md"
    Then the status is 200
    And the response path is "docs/README.md"

  Scenario: Secret-pattern file requires approval
    When I POST /chat/tools/read with path ".env"
    Then the status is 403
    And the error is "secret_pattern_requires_approval"

  Scenario: Binary file is refused
    Given "<tmp>/ws/blob.bin" contains NUL bytes
    When I POST /chat/tools/read with path "blob.bin"
    Then the status is 415
    And the error is "binary"

  Scenario: Oversized file is truncated and marked
    Given "<tmp>/ws/big.txt" is 300000 bytes
    When I POST /chat/tools/read with path "big.txt"
    Then the status is 200
    And truncated is true
    And bytes is 262144

  Scenario: Output redaction hides known secret shapes
    Given "<tmp>/ws/notes.txt" contains "key=sk-abcdefghijklmnopqrstuvwxyz0123"
    When I POST /chat/tools/read with path "notes.txt"
    Then the content contains "[redacted:"
    And redactions is 1

  Scenario: No workspace means no tools
    When I POST /chat/tools/read with cwd "<tmp>/not-registered" and path "docs/README.md"
    Then the status is 400
    And the error is "no-workspace"

  Scenario: Missing sidecar token is rejected
    Given the sidecar token header is absent
    When I POST /chat/tools/read with path "docs/README.md"
    Then the status is 401
