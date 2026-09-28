"""Windows job lifetime tracking, including descendants whose parent already exited.

This only manages process lifetime; it does not restrict filesystem/network access.
"""
import os


class ProcessTree:
    def __init__(self):
        self.handle = None
        if os.name != 'nt':
            return
        import ctypes
        from ctypes import wintypes

        class BasicLimits(ctypes.Structure):
            # Field names other than ``flags`` are ABI padding metadata; changing
            # them cannot affect layout or runtime behaviour.
            _fields_ = [('process_time', ctypes.c_int64), ('job_time', ctypes.c_int64),  # pragma: no mutate
                        ('flags', wintypes.DWORD), ('min_working_set', ctypes.c_size_t),  # pragma: no mutate
                        ('max_working_set', ctypes.c_size_t), ('active_processes', wintypes.DWORD),  # pragma: no mutate
                        ('affinity', ctypes.c_size_t), ('priority', wintypes.DWORD), ('scheduling', wintypes.DWORD)]  # pragma: no mutate

        class ExtendedLimits(ctypes.Structure):
            _fields_ = [('basic', BasicLimits), ('io_counters', ctypes.c_uint64 * 6),  # pragma: no mutate
                        ('process_memory', ctypes.c_size_t), ('job_memory', ctypes.c_size_t),  # pragma: no mutate
                        ('peak_process_memory', ctypes.c_size_t), ('peak_job_memory', ctypes.c_size_t)]  # pragma: no mutate

        api = ctypes.WinDLL('kernel32', use_last_error=True)
        signatures = {
            'CreateJobObjectW': ([ctypes.c_void_p, wintypes.LPCWSTR], wintypes.HANDLE),
            'SetInformationJobObject': ([wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD], wintypes.BOOL),
            'OpenProcess': ([wintypes.DWORD, wintypes.BOOL, wintypes.DWORD], wintypes.HANDLE),
            'AssignProcessToJobObject': ([wintypes.HANDLE, wintypes.HANDLE], wintypes.BOOL),
            'TerminateJobObject': ([wintypes.HANDLE, wintypes.UINT], wintypes.BOOL),
            'CloseHandle': ([wintypes.HANDLE], wintypes.BOOL),
        }
        for name, (args, result) in signatures.items():
            function = getattr(api, name)
            function.argtypes, function.restype = args, result
        self.api, self.ctypes = api, ctypes
        self.handle = api.CreateJobObjectW(None, None)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        limits = ExtendedLimits()
        limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not api.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            error = ctypes.WinError(ctypes.get_last_error())
            self.close()
            raise error

    def attach(self, pid):
        if self.handle is None:
            return
        process = self.api.OpenProcess(0x0101, False, pid)  # SET_QUOTA | TERMINATE
        if not process:
            raise self.ctypes.WinError(self.ctypes.get_last_error())
        try:
            if not self.api.AssignProcessToJobObject(self.handle, process):
                raise self.ctypes.WinError(self.ctypes.get_last_error())
        finally:
            self.api.CloseHandle(process)

    def terminate(self):
        if self.handle is not None:
            self.api.TerminateJobObject(self.handle, 1)

    def close(self):
        if self.handle is not None:
            self.api.CloseHandle(self.handle)
            self.handle = None
