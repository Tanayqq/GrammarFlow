import unittest
from recorder import record


class RecorderTests(unittest.TestCase):
    def test_long_function_names_stay_within_protocol(self):
        name='function_'+'x'*100
        r=record(f'def {name}():\n    return 1\nprint({name}())')
        self.assertEqual(r['stdout'],'1\n')
        self.assertTrue(all(len(label)<=80 for step in r['steps'] for label in step['stack']))
        r=record(f'def {name}():\n    return 1/0\n{name}()')
        self.assertEqual(r['error']['type'],'ZeroDivisionError')
        self.assertTrue(all(len(frame['function'])<=80 for frame in r['error']['frames']))
    def test_line_semantics(self):
        r = record('x = 1\nx = 2\nprint(x)')
        lines = [s for s in r['steps'] if s['event'] == 'line']
        self.assertEqual([(s['line'], s['vars'].get('x'), s['causedBy']) for s in lines],
                         [(1, None, None), (2, '1', 1), (3, '2', 2)])
        self.assertEqual(r['steps'][-1]['stdout'], '2\n')

    def test_loop_and_function(self):
        r = record('def double(n):\n    return n * 2\nx = 0\nfor i in range(3):\n    x += double(i)\nprint(x)')
        self.assertEqual(r['stdout'], '6\n')
        self.assertTrue(any(s.get('returnValue') == '4' for s in r['steps']))
        self.assertTrue(any(s['stack'] == ['<module>', 'double'] for s in r['steps']))

    def test_sort(self):
        r = record('a = [3, 1, 2]\nfor i in range(len(a)):\n    for j in range(len(a)-1):\n        if a[j] > a[j+1]:\n            a[j], a[j+1] = a[j+1], a[j]\nprint(a)')
        self.assertEqual(r['stdout'], '[1, 2, 3]\n')
        self.assertEqual(r['steps'][-1]['vars']['a'], '[1, 2, 3]')

    def test_recursion(self):
        r = record('def f(n):\n    return 1 if n == 0 else n*f(n-1)\nprint(f(4))')
        self.assertEqual(r['stdout'], '24\n')
        r = record('def f():\n    return f()\nf()')
        self.assertEqual(r['error']['type'], 'RecursionError')

    def test_hostile_repr_and_cycles(self):
        r = record('class Bad:\n    def __repr__(self):\n        raise RuntimeError("must not run")\nx = Bad()\na = []\na.append(a)\nb = list(range(100000))\nprint("ok")')
        self.assertIsNone(r['error'])
        self.assertEqual(r['stdout'], 'ok\n')
        self.assertEqual(r['steps'][-1]['vars']['x'], '<Bad>')
        self.assertIn('<cycle>', r['steps'][-1]['vars']['a'])
        self.assertLessEqual(len(r['steps'][-1]['vars']['b']), 200)

    def test_limits_errors_input_and_recovery(self):
        self.assertEqual(record('while True: pass')['meta']['stopReason'], 'step_limit')
        r = record('print("x" * 10000)')
        self.assertEqual(r['meta']['stopReason'], 'output_limit')
        self.assertIn('[output truncated]', r['stdout'])
        r = record('for i in range(4):\n    try:\n        print("x" * 10000)\n    except BaseException:\n        pass')
        self.assertEqual(r['meta']['stopReason'], 'output_limit')
        self.assertLessEqual(len(r['stdout']), 4020)
        self.assertEqual(r['stdout'].count('[output truncated]'), 1)
        r = record('x = 1\ny = 1/0')
        self.assertEqual(r['error']['type'], 'ZeroDivisionError')
        self.assertTrue(any(s['event'] == 'exception' for s in r['steps']))
        self.assertEqual(record('print(input())', ['hi'])['stdout'], 'hi\n')
        self.assertEqual(record('input()')['error']['type'], 'EOFError')
        self.assertEqual(record('x =')['error']['type'], 'SyntaxError')
        self.assertEqual(record('print(42)')['stdout'], '42\n')

    def test_metaclass_and_hostile_dict_keys(self):
        r = record('class Meta(type):\n    def __eq__(self, other):\n        raise RuntimeError("comparison called")\n    @property\n    def __name__(self):\n        raise RuntimeError("descriptor called")\nclass X(metaclass=Meta):\n    def __repr__(self):\n        raise RuntimeError("repr called")\nx=X()\nprint("ok")')
        self.assertIsNone(r['error'])
        self.assertEqual(r['steps'][-1]['vars']['x'], '<object>')
        r = record('class Key:\n    count=0\n    def __hash__(self):\n        Key.count+=1\n        return 1\nk=Key()\nd={k:42}\nprint(Key.count)')
        self.assertEqual(r['stdout'], '1\n')

    def test_deleted_and_final_state(self):
        r = record('x=1\ndel x\ny=2')
        self.assertIn('x', r['steps'][-2]['deleted'])
        self.assertEqual(r['steps'][-1]['vars']['y'], '2')
        self.assertEqual(r['steps'][-1]['causedBy'], 3)


if __name__ == '__main__':
    unittest.main()
