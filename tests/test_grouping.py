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


def test_truncate_message_under_limit():
    from nahiarhdLOG.grouping import truncate_message

    msg = "line1\nline2\nline3"
    assert truncate_message(msg, max_chars=100) == msg


def test_truncate_message_preserves_head_and_tail_on_newlines():
    from nahiarhdLOG.grouping import truncate_message

    lines = [f"frame_{i}: some code context here" for i in range(100)]
    lines.append("DomainError: something went wrong at the end")
    full_msg = "\n".join(lines)
    truncated = truncate_message(full_msg, max_chars=500)

    assert len(truncated) <= 600
    assert "truncated" in truncated
    assert truncated.startswith("frame_0: some code context here")
    assert truncated.endswith("DomainError: something went wrong at the end")
    # Verify no line is chopped into partial tokens
    for line in truncated.split("\n"):
        if line and not line.startswith("[..."):
            assert line in lines

