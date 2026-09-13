from nahiarhdLOG.grouping import from_traceback, signature


def test_signature_format_uses_basename():
    assert signature("ValueError", "/app/views.py", 42) == "ValueError@views.py:42"


def test_signature_handles_missing_parts():
    assert signature("", None, None) == "?@?:0"


def test_from_traceback_picks_innermost_frame():
    def inner():
        raise KeyError("k-marker")

    def outer():
        inner()

    try:
        outer()
    except KeyError as e:
        sig, filename, lineno = from_traceback(type(e).__name__, e.__traceback__)
    assert sig.startswith("KeyError@test_grouping.py:")
    assert filename and filename.endswith("test_grouping.py")
    assert isinstance(lineno, int) and lineno > 0


def test_from_traceback_without_tb():
    sig, filename, lineno = from_traceback("RuntimeError", None)
    assert sig == "RuntimeError@?:0"
    assert filename is None
