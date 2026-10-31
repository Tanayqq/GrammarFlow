"""A small expense report: functions, loops, dictionaries and recursion."""

def valid_rows(rows):
    cleaned = []
    for category, amount in rows:
        if amount >= 0:
            cleaned.append((category, amount))
    return cleaned

def group_totals(rows):
    grouped = {}
    for category, amount in rows:
        grouped[category] = grouped.get(category, 0) + amount
    return grouped

def running_totals(values):
    result = []
    total = 0
    for value in values:
        total += value
        result.append(total)
    return result

def insertion_sort(values):
    result = values[:]
    for index in range(1, len(result)):
        value = result[index]
        position = index - 1
        while position >= 0 and result[position] > value:
            result[position + 1] = result[position]
            position -= 1
        result[position + 1] = value
    return result

def find_value(values, target):
    left = 0
    right = len(values) - 1
    while left <= right:
        middle = (left + right) // 2
        if values[middle] == target:
            return middle
        if values[middle] < target:
            left = middle + 1
        else:
            right = middle - 1
    return -1

def factorial(number):
    if number <= 1:
        return 1
    return number * factorial(number - 1)

def safe_average(values):
    if not values:
        return 0
    return sum(values) / len(values)

def make_report(rows):
    cleaned = valid_rows(rows)
    values = [amount for category, amount in cleaned]
    grouped = group_totals(cleaned)
    ordered = insertion_sort(values)
    report = {
        'count': len(cleaned),
        'total': sum(values),
        'average': safe_average(values),
        'groups': grouped,
        'ordered': ordered,
        'running': running_totals(values),
        'found': find_value(ordered, 12),
        'missing': find_value(ordered, 99),
        'factorial': factorial(4),
    }
    return report

transactions = [
    ('books', 12),
    ('food', 8),
    ('books', 5),
    ('travel', 15),
    ('food', 10),
    ('ignored', -3),
]
report = make_report(transactions)
assert report['count'] == 5
assert report['total'] == 50
assert report['average'] == 10
assert report['groups'] == {'books': 17, 'food': 18, 'travel': 15}
assert report['ordered'] == [5, 8, 10, 12, 15]
assert report['running'] == [12, 20, 25, 40, 50]
assert report['found'] == 3
assert report['missing'] == -1
assert report['factorial'] == 24
print('TOTAL', report['total'])
print('SORTED', report['ordered'])
print('RUNNING', report['running'])
print('FOUND', report['found'])
print('MISSING', report['missing'])
print('FACTORIAL', report['factorial'])
print('AVERAGE', report['average'])
