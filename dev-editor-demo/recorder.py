"""Bounded teaching trace. Not a Python security sandbox."""
import sys
import json
import io


def record(code, inputs=(), max_steps=500, emit=None):
    filename = '<grammarflow-user>'
    steps, previous, previous_line = [], {}, {}
    meta = {'language': 'python', 'truncated': False, 'stopReason': None,
            'lineSemantics': 'State before the named line executes; causedBy is the previous observed line in this frame.'}
    output, input_values = [], iter(inputs)
    output_length = 0
    error = None
    trace_bytes = 0

    class Limit(BaseException):
        pass

    def type_name(t):
        return type.__getattribute__(t, '__name__')[:60] if type(t) is type else 'object'

    def preview(value, depth=0, seen=None):
        t = type(value)
        if t is int:
            return str(value) if int.bit_length(value) < 640 else '<large int>'
        if any(t is kind for kind in (float, bool, type(None))):
            return repr(value)
        if t is str:
            return repr(value[:160])[:200] + ('…' if len(value) > 160 else '')
        if t is range:
            return ('range(' + ', '.join(preview(x) for x in (value.start, value.stop, value.step)) + ')')[:200]
        if not any(t is kind for kind in (list, tuple, set, dict)):
            # Bypass custom metaclass attribute access as well as object repr/len.
            return '<' + type_name(t) + '>'
        seen = set() if seen is None else seen
        if id(value) in seen:
            return '<cycle>'
        if depth >= 2:
            return '<' + t.__name__ + '…>'
        seen.add(id(value))
        try:
            parts = []
            items = dict.items(value) if t is dict else value
            for index, item in enumerate(items):
                if index >= 50:
                    parts.append('…')
                    break
                if t is dict:
                    key, entry = item
                    part = preview(key, depth + 1, seen) + ': ' + preview(entry, depth + 1, seen)
                else:
                    part = preview(item, depth + 1, seen)
                parts.append(part)
                if sum(map(len, parts)) > 180:
                    parts.append('…')
                    break
            opening, closing = ('[', ']') if t is list else ('(', ')') if t is tuple else ('{', '}')
            return (opening + ', '.join(parts) + closing)[:200]
        finally:
            seen.remove(id(value))

    class Output(io.TextIOBase):
        def write(self, text):
            nonlocal output_length
            if meta['stopReason'] == 'output_limit':
                raise Limit()
            remaining = 4000 - output_length
            if len(text) > remaining:
                output.append(text[:max(0, remaining)] + '\n[output truncated]')
                output_length = 4000
                meta.update(truncated=True, stopReason='output_limit')
                raise Limit()
            output.append(text)
            output_length += len(text)
            return len(text)

    def read_input(prompt=''):
        if prompt:
            print(prompt, end='')
        try:
            return next(input_values)
        except StopIteration:
            raise EOFError('No pre-supplied input remains. Add test input before running.') from None

    def trace(frame, event, arg):
        nonlocal trace_bytes
        if frame.f_code.co_filename != filename:
            return None
        if event not in ('line', 'return', 'exception', 'call'):
            return trace
        if len(steps) >= max_steps:
            meta.update(truncated=True, stopReason='step_limit')
            raise Limit()
        frame_id = id(frame)
        values = {}
        for name, value in frame.f_locals.items():
            if name.startswith('__'):
                continue
            if len(values) >= 50:
                values['…'] = '<variable limit>'
                break
            values[name[:80]] = preview(value)
        old = previous.get(frame_id, {})
        changed = [k for k in values if values[k] != old.get(k)]
        deleted = [k for k in old if k not in values]
        stack, cursor = [], frame
        while cursor is not None and len(stack) < 40:
            if cursor.f_code.co_filename == filename:
                stack.append(cursor.f_code.co_name[:80])
            cursor = cursor.f_back
        step = {'i': len(steps), 'line': frame.f_lineno, 'event': event,
                'vars': values, 'changed': changed, 'deleted': deleted,
                'causedBy': previous_line.get(frame_id), 'stdout': ''.join(output),
                'stack': list(reversed(stack))}
        if event == 'exception':
            step['exception'] = type_name(arg[0])
        if event == 'return':
            step['returnValue'] = preview(arg)
        encoded = json.dumps(step, ensure_ascii=True)
        trace_bytes += len(encoded)
        if trace_bytes > 1000000:
            meta.update(truncated=True, stopReason='trace_size_limit')
            raise Limit()
        steps.append(step)
        if emit is not None:
            emit(encoded)
        previous[frame_id] = values
        if event == 'line':
            previous_line[frame_id] = frame.f_lineno
        if event == 'return':
            previous.pop(frame_id, None)
            previous_line.pop(frame_id, None)
        return trace

    namespace = {'__name__': '__main__', 'input': read_input}
    old_stdout, old_stderr, old_trace = sys.stdout, sys.stderr, sys.gettrace()
    old_recursion = sys.getrecursionlimit()
    try:
        compiled = compile(code, filename, 'exec')
        sys.setrecursionlimit(160)
        sys.stdout = sys.stderr = Output()
        sys.settrace(trace)
        exec(compiled, namespace)
    except Limit:
        pass
    except BaseException as exc:
        sys.settrace(None)
        frames, tb = [], exc.__traceback__
        while tb is not None:
            if tb.tb_frame.f_code.co_filename == filename:
                frames.append({'line': tb.tb_lineno, 'function': tb.tb_frame.f_code.co_name[:80]})
            tb = tb.tb_next
        # Never call custom exception __str__ or __repr__.
        args = BaseException.args.__get__(exc, type(exc))
        error = {'type': type_name(type(exc)),
                 'message': preview(args), 'frames': frames[-40:]}
        if type(exc) is SyntaxError:
            error['line'] = exc.lineno
        meta['stopReason'] = 'error'
    finally:
        sys.settrace(old_trace)
        sys.stdout, sys.stderr = old_stdout, old_stderr
        sys.setrecursionlimit(old_recursion)
    return {'meta': meta, 'steps': steps, 'stdout': ''.join(output), 'error': error}


def run_json(payload, emit=None):
    data = json.loads(payload)
    return json.dumps(record(data['code'], data.get('inputs', []), emit=emit), ensure_ascii=True)
