import {run} from './runner.js';
const $=id=>document.getElementById(id);
const examples={loop:'total = 0\nfor i in range(3):\n    total += i\nprint(total)',sort:'numbers = [4, 1, 3, 2]\nfor i in range(len(numbers)):\n    for j in range(len(numbers) - 1 - i):\n        if numbers[j] > numbers[j + 1]:\n            numbers[j], numbers[j + 1] = numbers[j + 1], numbers[j]\nprint(numbers)',recursion:'def factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)\n\nprint(factorial(4))',error:'numbers = [10, 20, 30]\nprint(numbers[3])'};
let trace=null,source='',position=0,playing=null,controller=null,aiController=null;
const languageExamples={"Python": "total = 0\nfor i in range(3):\n    total += i\nprint(total)", "JavaScript": "const numbers = [1, 2, 3];\nlet total = 0;\nfor (const n of numbers) {\n  total += n;\n}\nconsole.log(total);", "TypeScript": "const numbers: number[] = [1, 2, 3];\nconst total: number = numbers.reduce((sum, n) => sum + n, 0);\nconsole.log(total);", "Java": "class Main {\n  public static void main(String[] args) {\n    int total = 0;\n    for (int i = 1; i <= 3; i++) total += i;\n    System.out.println(total);\n  }\n}", "C": "#include <stdio.h>\nint main(void) {\n  int total = 0;\n  for (int i = 1; i <= 3; i++) total += i;\n  printf(\"%d\\n\", total);\n  return 0;\n}", "C++": "#include <iostream>\nint main() {\n  int total = 0;\n  for (int i = 1; i <= 3; ++i) total += i;\n  std::cout << total << \"\\n\";\n}", "C#": "using System;\nclass Program {\n  static void Main() {\n    int total = 0;\n    for (int i = 1; i <= 3; i++) total += i;\n    Console.WriteLine(total);\n  }\n}", "Go": "package main\nimport \"fmt\"\nfunc main() {\n  total := 0\n  for i := 1; i <= 3; i++ { total += i }\n  fmt.Println(total)\n}", "Rust": "fn main() {\n  let numbers = [1, 2, 3];\n  let total: i32 = numbers.iter().sum();\n  println!(\"{}\", total);\n}", "PHP": "<?php\n$numbers = [1, 2, 3];\n$total = array_sum($numbers);\necho $total;", "Ruby": "numbers = [1, 2, 3]\ntotal = numbers.sum\nputs total", "SQL": "CREATE TABLE expenses (category TEXT, amount INTEGER);\nINSERT INTO expenses VALUES ('Books', 10), ('Books', 20), ('Food', 5);\nSELECT category, SUM(amount) AS total\nFROM expenses\nGROUP BY category\nORDER BY total DESC;"};
const aiCache=new Map();
const conceptGuides={
  "Python": [
    [
      "Names and assignment",
      "\\b\\w+\\s*=",
      "Assignment binds a name to an object; it does not automatically make a separate copy of a list or dictionary. Two names can refer to the same mutable object.",
      "Assignment se naam kisi object se judta hai; list ya dictionary ki alag copy apne aap nahi banti. Do naam ek hi badalne wale object ko refer kar sakte hain."
    ],
    [
      "Loops and range",
      "\\b(for|while|range|break|continue)\\b",
      "for visits items in an iterable. range stops before its end value. break exits the nearest loop; continue skips to its next iteration. A while loop needs a condition that eventually changes.",
      "for iterable ke items par chalta hai. range mein end value shamil nahi hoti. break sabse paas wale loop ko chhodta hai; continue agli iteration par jata hai. while ki condition ko badalne ka rasta chahiye."
    ],
    [
      "Functions and return",
      "\\b(def|return|lambda)\\b",
      "def creates a function. Parameters receive arguments when it is called. return exits that function with a value; a function that reaches its end returns None.",
      "def function banata hai. Call hone par arguments parameters ko milte hain. return value ke saath us function se bahar nikalta hai; end tak pahunchne par function None return karta hai."
    ],
    [
      "Lists and dictionaries",
      "\\[|\\b(dict|list|append|items|keys|values)\\b",
      "Lists are ordered, mutable sequences indexed from zero. Dictionaries map keys to values. Accessing a missing list index raises IndexError; a missing dictionary key normally raises KeyError.",
      "List ordered aur badalne wali sequence hai, jiska index zero se shuru hota hai. Dictionary keys ko values se jodti hai. Galat list index par IndexError aur missing dictionary key par aam taur par KeyError milta hai."
    ],
    [
      "Input, output and conversion",
      "\\b(print|input|int|float)\\s*\\(",
      "print writes output. input reads text; convert it with int or float when a number is required. Invalid numeric text raises ValueError instead of becoming a valid number automatically.",
      "print output dikhata hai. input text deta hai; number chahiye toh int ya float se convert karein. Galat numeric text par ValueError milta hai, apne aap sahi number nahi banta."
    ],
    [
      "Exceptions",
      "\\b(try|except|raise|finally)\\b",
      "try groups operations that may fail. except handles matching exceptions. finally runs when control leaves the try statement, including many error paths; catching an error does not prove the result is correct.",
      "try mein fail ho sakne wala code rakhte hain. except matching error sambhalta hai. try se nikalte waqt finally chalta hai, kai error paths mein bhi; error catch karna sahi result ka proof nahi hai."
    ]
  ],
  "JavaScript": [
    [
      "let, const and object mutation",
      "\\b(let|const|var)\\b",
      "let permits reassignment. const prevents rebinding that variable, but an array or object held by const can still be changed. var has different scope rules from block-scoped let and const.",
      "let mein variable ko dobara assign kar sakte hain. const us naam ko nayi value se jodne se rokta hai, lekin uske array ya object ke andar badlav ho sakta hai. var ke scope rules alag hain."
    ],
    [
      "Arrays and iteration",
      "\\[|\\b(for|while|map|filter|reduce)\\b",
      "Arrays use zero-based indexes. for...of visits values; for...in visits property names. map creates mapped results, filter selects items, and reduce combines items into an accumulator.",
      "Array ka index zero se shuru hota hai. for...of values deta hai; for...in property names deta hai. map nayi mapped values banata hai, filter items chunta hai aur reduce unhein accumulator mein jodta hai."
    ],
    [
      "Functions and callbacks",
      "\\b(function|return)\\b|=>",
      "Functions receive inputs and can return values. A callback is a function passed to another function. In an arrow function with braces, use return to return a value explicitly.",
      "Function input leta hai aur value return kar sakta hai. Callback woh function hai jo doosre function ko diya jata hai. Arrow function mein braces hon toh value lautane ke liye return likhna padta hai."
    ],
    [
      "Promises and await",
      "\\b(async|await|Promise|then|catch)\\b",
      "A Promise represents eventual completion or failure. await pauses the current async function until that value settles; it does not freeze the entire program. Handle failures with try/catch or a rejection handler.",
      "Promise baad mein poore hone ya fail hone wale kaam ko dikhata hai. await current async function ko result tak rokta hai, poore program ko nahi. Failure ko try/catch ya rejection handler se sambhalein."
    ],
    [
      "Output and numeric limits",
      "\\b(console|Number|BigInt)\\b",
      "console.log writes output. Number uses floating-point arithmetic and cannot represent every large integer exactly; Number.MAX_SAFE_INTEGER marks the upper positive safe-integer boundary. BigInt supports larger integers but is a different numeric type.",
      "console.log output dikhata hai. Number floating-point hai aur har bade integer ko exactly nahi rakh sakta. Number.MAX_SAFE_INTEGER safe positive integer ki upar wali boundary hai. BigInt bade integers ke liye alag numeric type hai."
    ]
  ],
  "TypeScript": [
    [
      "let, const and object mutation",
      "\\b(let|const|var)\\b",
      "let permits reassignment. const prevents rebinding that variable, but an array or object held by const can still be changed. var has different scope rules from block-scoped let and const.",
      "let mein variable ko dobara assign kar sakte hain. const us naam ko nayi value se jodne se rokta hai, lekin uske array ya object ke andar badlav ho sakta hai. var ke scope rules alag hain."
    ],
    [
      "Arrays and iteration",
      "\\[|\\b(for|while|map|filter|reduce)\\b",
      "Arrays use zero-based indexes. for...of visits values; for...in visits property names. map creates mapped results, filter selects items, and reduce combines items into an accumulator.",
      "Array ka index zero se shuru hota hai. for...of values deta hai; for...in property names deta hai. map nayi mapped values banata hai, filter items chunta hai aur reduce unhein accumulator mein jodta hai."
    ],
    [
      "Functions and callbacks",
      "\\b(function|return)\\b|=>",
      "Functions receive inputs and can return values. A callback is a function passed to another function. In an arrow function with braces, use return to return a value explicitly.",
      "Function input leta hai aur value return kar sakta hai. Callback woh function hai jo doosre function ko diya jata hai. Arrow function mein braces hon toh value lautane ke liye return likhna padta hai."
    ],
    [
      "Promises and await",
      "\\b(async|await|Promise|then|catch)\\b",
      "A Promise represents eventual completion or failure. await pauses the current async function until that value settles; it does not freeze the entire program. Handle failures with try/catch or a rejection handler.",
      "Promise baad mein poore hone ya fail hone wale kaam ko dikhata hai. await current async function ko result tak rokta hai, poore program ko nahi. Failure ko try/catch ya rejection handler se sambhalein."
    ],
    [
      "Output and numeric limits",
      "\\b(console|Number|BigInt)\\b",
      "console.log writes output. Number uses floating-point arithmetic and cannot represent every large integer exactly; Number.MAX_SAFE_INTEGER marks the upper positive safe-integer boundary. BigInt supports larger integers but is a different numeric type.",
      "console.log output dikhata hai. Number floating-point hai aur har bade integer ko exactly nahi rakh sakta. Number.MAX_SAFE_INTEGER safe positive integer ki upar wali boundary hai. BigInt bade integers ke liye alag numeric type hai."
    ],
    [
      "Type annotations and inference",
      ":\\s*(number|string|boolean)|\\b(interface|type|unknown|any)\\b",
      "TypeScript checks types before execution and can infer many types without annotations. Most type information is erased during compilation; an annotation does not validate untrusted data at runtime. any bypasses many checks.",
      "TypeScript run se pehle types check karta hai aur kai types khud samajh leta hai. Compilation mein zyada type information hat jati hai; annotation runtime par untrusted data validate nahi karta. any kai checks ko bypass karta hai."
    ],
    [
      "Unions and narrowing",
      "\\||\\b(typeof|instanceof)\\b",
      "A union allows more than one type. Checks such as typeof, instanceof or a discriminant property narrow the possibilities, so operations can be chosen safely for the current type.",
      "Union ek se zyada type allow karta hai. typeof, instanceof ya identifying property ka check possibilities kam karta hai, taaki current type ke hisab se sahi operation chun sakein."
    ]
  ],
  "Java": [
    [
      "Classes, objects and methods",
      "\\b(class|new|static|void)\\b",
      "A class defines fields and methods; an object is an instance. static members belong to the class rather than an individual object. void means a method returns no value, not that it performs no work.",
      "Class fields aur methods define karti hai; object uski instance hota hai. static member kisi ek object ke bajay class se juda hota hai. void ka matlab return value nahi hai, kaam na karna nahi."
    ],
    [
      "main and standard output",
      "\\bmain\\s*\\(|System\\.out",
      "In the supported single-file runner, use class Main with public static void main(String[] args). System.out.println prints a value followed by a newline; the arguments array holds command-line arguments, not standard input.",
      "Is single-file runner mein class Main aur public static void main(String[] args) use karein. System.out.println value ke baad nayi line print karta hai. args command-line arguments rakhta hai, standard input nahi."
    ],
    [
      "Arrays, lists and loops",
      "\\[|\\b(for|while|ArrayList|List|length|size)\\b",
      "Arrays have fixed length and use zero-based indexes. ArrayList can grow; use length for an array and size() for a list. An enhanced for loop visits elements, not their indexes.",
      "Array ki length fixed hoti hai aur index zero se shuru hota hai. ArrayList badh sakti hai; array ke liye length aur list ke liye size() use hota hai. Enhanced for loop elements deta hai, indexes nahi."
    ],
    [
      "Integer division and overflow",
      "\\b(int|long|double|float)\\b",
      "int and long have fixed integer ranges, and ordinary integer overflow wraps instead of throwing an exception. Integer division truncates toward zero; convert an operand to double when a fractional result is needed.",
      "int aur long ki range fixed hai; aam integer overflow exception dene ke bajay wrap hota hai. Integer division decimal hissa hata deta hai; fractional result ke liye operand ko double banayein."
    ],
    [
      "References and equality",
      "\\b(null|equals|String|new)\\b|==",
      "For objects, == compares references while equals can compare logical content, depending on the class. Strings should normally be compared using equals. Calling an instance method through a null reference can throw NullPointerException.",
      "Objects ke liye == references compare karta hai, jabki equals class ke hisab se content compare kar sakta hai. Strings ko aam taur par equals se compare karein. null reference par instance method call karne se NullPointerException aa sakta hai."
    ]
  ],
  "C": [
    [
      "Headers and main",
      "#\\s*include|\\bmain\\s*\\(",
      "#include makes header declarations available during preprocessing. main is the program entry function; returning zero reports successful termination to the environment. A header declaration alone is not a function call.",
      "#include preprocessing mein header ki declarations available karta hai. main program ki entry function hai; zero return karna successful termination batata hai. Sirf header declaration hone se function call nahi hota."
    ],
    [
      "Types, division and overflow",
      "\\b(int|long|unsigned|double|float)\\b",
      "Integer types have finite ranges. Signed integer overflow has undefined behaviour; unsigned arithmetic wraps modulo its range. Integer division truncates toward zero. Floating-point arithmetic is approximate.",
      "Integer types ki range limited hai. Signed integer overflow ka behaviour defined nahi hai; unsigned arithmetic apni range ke hisab se wrap hoti hai. Integer division decimal hissa hata deta hai. Floating-point arithmetic approximate hoti hai."
    ],
    [
      "Loops and branches",
      "\\b(for|while|if|else|break|continue)\\b",
      "A condition selects a branch or controls a loop. break exits the nearest loop or switch; continue skips to the next loop iteration. Whether a loop terminates depends on its condition and updates.",
      "Condition branch chunti hai ya loop ko control karti hai. break sabse paas wale loop ya switch se nikalta hai; continue agli loop iteration par jata hai. Loop rukega ya nahi, yeh condition aur updates par nirbhar hai."
    ],
    [
      "Pointers and memory lifetime",
      "\\b(int|char|double|float|void)\\s*\\*|\\b(malloc|free|NULL)\\b|->",
      "A pointer stores an address. Dereference it only when it points to a valid live object of the appropriate type. malloc can fail; free releases allocated storage. A pointer does not automatically track the size of an array.",
      "Pointer address rakhta hai. Usse tabhi dereference karein jab woh sahi type ke valid aur live object ko point karta ho. malloc fail ho sakta hai; free allocated storage chhodta hai. Pointer array ka size apne aap track nahi karta."
    ],
    [
      "Arrays and formatted input/output",
      "\\[|\\b(printf|scanf|sizeof)\\s*\\(",
      "Arrays use zero-based indexes; C does not automatically check array bounds. Match printf/scanf format specifiers to argument types. scanf commonly needs an address where the value can be stored.",
      "Array ka index zero se shuru hota hai; C bounds ko apne aap check nahi karta. printf/scanf ke format specifiers argument ke type se milne chahiye. scanf ko aksar value rakhne ke liye address chahiye hota hai."
    ]
  ],
  "C++": [
    [
      "Headers and main",
      "#\\s*include|\\bmain\\s*\\(",
      "#include makes header declarations available during preprocessing. main is the program entry function; returning zero reports successful termination to the environment. A header declaration alone is not a function call.",
      "#include preprocessing mein header ki declarations available karta hai. main program ki entry function hai; zero return karna successful termination batata hai. Sirf header declaration hone se function call nahi hota."
    ],
    [
      "Types, division and overflow",
      "\\b(int|long|unsigned|double|float)\\b",
      "Integer types have finite ranges. Signed integer overflow has undefined behaviour; unsigned arithmetic wraps modulo its range. Integer division truncates toward zero. Floating-point arithmetic is approximate.",
      "Integer types ki range limited hai. Signed integer overflow ka behaviour defined nahi hai; unsigned arithmetic apni range ke hisab se wrap hoti hai. Integer division decimal hissa hata deta hai. Floating-point arithmetic approximate hoti hai."
    ],
    [
      "Loops and branches",
      "\\b(for|while|if|else|break|continue)\\b",
      "A condition selects a branch or controls a loop. break exits the nearest loop or switch; continue skips to the next loop iteration. Whether a loop terminates depends on its condition and updates.",
      "Condition branch chunti hai ya loop ko control karti hai. break sabse paas wale loop ya switch se nikalta hai; continue agli loop iteration par jata hai. Loop rukega ya nahi, yeh condition aur updates par nirbhar hai."
    ],
    [
      "Pointers and memory lifetime",
      "\\b(int|char|double|float|void)\\s*\\*|\\b(malloc|free|NULL)\\b|->",
      "A pointer stores an address. Dereference it only when it points to a valid live object of the appropriate type. malloc can fail; free releases allocated storage. A pointer does not automatically track the size of an array.",
      "Pointer address rakhta hai. Usse tabhi dereference karein jab woh sahi type ke valid aur live object ko point karta ho. malloc fail ho sakta hai; free allocated storage chhodta hai. Pointer array ka size apne aap track nahi karta."
    ],
    [
      "Arrays and formatted input/output",
      "\\[|\\b(printf|scanf|sizeof)\\s*\\(",
      "Arrays use zero-based indexes; C does not automatically check array bounds. Match printf/scanf format specifiers to argument types. scanf commonly needs an address where the value can be stored.",
      "Array ka index zero se shuru hota hai; C bounds ko apne aap check nahi karta. printf/scanf ke format specifiers argument ke type se milne chahiye. scanf ko aksar value rakhne ke liye address chahiye hota hai."
    ],
    [
      "Standard streams and namespaces",
      "\\b(std|cout|cin|endl)\\b",
      "std names the standard-library namespace. cout writes output with << and cin reads input with >>. Check input success when data may be invalid; endl also flushes the stream, unlike a plain newline.",
      "std standard library ka namespace hai. cout mein << se output aur cin mein >> se input lete hain. Data galat ho sakta ho toh input success check karein; endl nayi line ke saath stream flush bhi karta hai."
    ],
    [
      "Vectors and object lifetime",
      "\\b(vector|class|unique_ptr|shared_ptr|auto)\\b",
      "vector is a resizable sequence. at() checks bounds and can throw; operator[] does not perform a required bounds check. C++ objects can own resources and release them through destructors when their lifetime ends.",
      "vector badalne wali size ki sequence hai. at() bounds check karta hai aur exception de sakta hai; operator[] mein required bounds check nahi hota. C++ object resources own karke lifetime khatam hone par destructor se chhod sakta hai."
    ]
  ],
  "C#": [
    [
      "Classes, static and entry point",
      "\\b(class|static|Main|void)\\b",
      "Classes define members; static members belong to the type rather than an individual instance. Main is a conventional entry point for this runner. void means no return value. It does not mean the method has no side effects.",
      "Class members define karti hai; static member kisi instance ke bajay type se juda hota hai. Is runner mein Main entry point use hota hai. void ka matlab return value nahi hai; method phir bhi kaam ya side effects kar sakta hai."
    ],
    [
      "Arrays, lists and iteration",
      "\\[|\\b(for|foreach|while|List|Length|Count)\\b",
      "Arrays have fixed length; List<T> can grow. Use Length for arrays and Count for lists. foreach visits elements. Invalid array or list indexes throw instead of providing a valid missing value.",
      "Array ki length fixed hai; List<T> badh sakti hai. Array mein Length aur list mein Count use karein. foreach elements par chalta hai. Galat index par exception milta hai, koi valid missing value nahi."
    ],
    [
      "Arithmetic and checked contexts",
      "\\b(int|long|double|decimal|checked|unchecked)\\b",
      "Integer division truncates toward zero. For built-in integral arithmetic, a checked context detects overflow and throws; unchecked arithmetic can wrap. Constant-expression overflow is generally checked at compile time. decimal and double have different precision and range.",
      "Integer division decimal hissa hata deta hai. Built-in integer arithmetic mein checked overflow par exception deta hai; unchecked mein value wrap ho sakti hai. Constant expression ka overflow aam taur par compile time par check hota hai. decimal aur double ki precision aur range alag hain."
    ],
    [
      "Console input and parsing",
      "\\b(Console|Parse|TryParse)\\b",
      "Console.WriteLine prints output. Console.ReadLine returns text and can return null. TryParse lets you test numeric conversion without relying on a format exception for invalid input.",
      "Console.WriteLine output dikhata hai. Console.ReadLine text deta hai aur null bhi de sakta hai. TryParse se numeric conversion check kar sakte hain, bina galat input ke liye format exception par nirbhar hue."
    ],
    [
      "Async tasks",
      "\\b(async|await|Task)\\b",
      "Task represents an asynchronous operation. await pauses the current async method until completion without requiring the whole application to stop. Await the task or otherwise observe failures.",
      "Task asynchronous kaam ko represent karta hai. await current async method ko completion tak rokta hai, poori application ko rukna zaroori nahi. Task ko await karein ya uski failure ko doosre tareeqe se observe karein."
    ]
  ],
  "Go": [
    [
      "Declarations and zero values",
      ":=|\\b(var|const|int|float64)\\b",
      "var declares a variable; := is a short declaration inside functions and must introduce at least one new non-blank variable in the same scope. Uninitialized variables receive their type zero value, such as 0, false or an empty string.",
      "var variable declare karta hai; := function ke andar short declaration hai aur same scope mein kam se kam ek naya non-blank variable chahiye. Bina explicit initialization ke type ki zero value milti hai, jaise 0, false ya khali string."
    ],
    [
      "Functions, packages and output",
      "\\b(package|import|func|fmt|Println|return)\\b",
      "package organizes Go source. The main function in package main starts the executable. Functions can return multiple values; fmt.Println prints its arguments and a newline. An imported package must be used.",
      "package Go source ko organize karta hai. package main ka main function executable shuru karta hai. Function multiple values return kar sakta hai; fmt.Println arguments aur nayi line print karta hai. Imported package ko use karna padta hai."
    ],
    [
      "Slices and arrays",
      "\\[|\\b(append|len|cap|make)\\b",
      "Arrays have a fixed length. A slice describes a portion of an underlying array; slices may share that storage. append can allocate a new array, so use its returned slice. len and cap have different meanings.",
      "Array ki length fixed hoti hai. Slice underlying array ke ek hisse ko dikhati hai; slices wahi storage share kar sakti hain. append naya array allocate kar sakta hai, isliye returned slice use karein. len aur cap alag cheezein hain."
    ],
    [
      "Loops and range",
      "\\b(for|range|break|continue)\\b",
      "for is Go's looping construct. range over a slice can provide its index and a copy of each element value. Assigning to that copied value alone does not update the original element; use the index when updating the slice.",
      "for Go ka loop construct hai. Slice par range index aur har element ki value ki copy de sakta hai. Sirf us copied value ko badalne se original element nahi badalta; slice update karne ke liye index use karein."
    ],
    [
      "Errors and concurrency",
      "\\b(err|error|go|chan|defer)\\b",
      "Errors are often returned as values; check err rather than assuming success. go starts a goroutine, and channels can coordinate goroutines. defer schedules a call for the surrounding function return, not merely the end of a loop iteration.",
      "Errors aksar values ke roop mein return hote hain; success maan lene ke bajay err check karein. go goroutine shuru karta hai aur channels unhein coordinate kar sakte hain. defer ka call surrounding function return par hota hai, sirf loop iteration ke end par nahi."
    ]
  ],
  "Rust": [
    [
      "Reverse / BinaryHeap",
      "\\b(Reverse|BinaryHeap)\\b",
      "BinaryHeap normally pops the largest item first. Reverse reverses comparison order, so wrapped entries can be popped smallest first. For distance-node pairs, distance is compared first.",
      "BinaryHeap aam taur par sabse bada item pehle nikalta hai. Reverse comparison ka order ulta karta hai, isliye wrapped entries mein sabse chhoti value pehle aa sakti hai. Distance-node pair mein pehle distance compare hota hai."
    ],
    [
      "Debug / Clone / Copy",
      "\\b(Debug|Clone|Copy)\\b",
      "Debug enables debugging output such as {:?}. Clone provides explicit duplication with .clone(). Copy allows implicit value copying on assignment instead of moving ownership; it does not mean a deep copy of heap data.",
      "Debug se {:?} format mein debugging ke liye value dikhate hain. Clone se .clone() call karke duplicate banate hain. Copy assignment par ownership move karne ke bajay value copy hone deta hai; iska matlab heap data ki deep copy nahi hai."
    ],
    [
      "usize / u64",
      "\\b(usize|u64)\\b",
      "usize is an unsigned integer whose width matches the target pointer width; it is commonly used for indexing. u64 is a 64-bit unsigned integer. Both have finite ranges; choosing a larger type does not prevent overflow.",
      "usize ek unsigned integer hai jiska size target ke pointer width ke barabar hota hai; indexing mein iska istemal hota hai. u64 ek 64-bit unsigned integer hai. Dono ki range limited hai; bada type lene se overflow ki sambhavna khatam nahi hoti."
    ],
    [
      "checked_add",
      "\\bchecked_add\\b",
      "For integer addition, checked_add returns Some(sum) when the result fits, or None on overflow. It does not wrap the result around or silently return zero.",
      "Integer addition mein checked_add ka result fit hone par Some(sum) milta hai; overflow par None milta hai. Yeh result ko wrap karke chhota number ya chupke se zero nahi banata."
    ],
    [
      "Option / Result and ?",
      "\\?|\\b(Option|Result)\\b",
      "For Option, ? extracts a Some value or returns None from the enclosing function. For Result, it extracts Ok or propagates Err. It is not an unwrap() call and does not make preceding array indexing bounds-safe.",
      "Option par ? ko Some milne se uski value milti hai; None milne par poora function None return karta hai. Result par Ok ki value milti hai ya Err aage return hota hai. Yeh unwrap() call nahi hai aur array indexing ko bounds-safe nahi banata."
    ],
    [
      "Nested vectors",
      "Vec\\s*<\\s*Vec\\s*<",
      "Vec<Vec<T>> is a list of lists. In an adjacency-list graph, each node has a list of its connected edges; the outer index selects a node and the inner list holds its edges.",
      "Vec<Vec<T>> lists ki ek list hai. Adjacency-list wale graph mein har node ki connected edges ki alag list hoti hai; bahar ka index node chunta hai aur andar ki list uski edges rakhti hai."
    ],
    [
      "Bindings and mut",
      "\\b(let|mut|const)\\b",
      "Rust bindings are immutable by default. mut allows a binding or borrowed value to be changed where the type and borrow rules permit it. A type annotation chooses a type; it does not remove that type's range limits.",
      "Rust binding default roop se immutable hoti hai. mut se binding ya borrowed value badal sakti hai, jab type aur borrow rules allow karein. Type annotation type chunta hai; us type ki range limit khatam nahi hoti."
    ],
    [
      "Functions and return values",
      "\\b(fn|return)\\b",
      "fn defines a function. A final expression without a semicolon can be its return value; return exits earlier. Function parameters have types, and references can borrow values rather than taking ownership.",
      "fn function define karta hai. Aakhri expression ke baad semicolon na ho toh woh return value ban sakta hai; return pehle bahar nikalta hai. Parameters ke types hote hain aur references ownership lene ke bajay value borrow kar sakte hain."
    ],
    [
      "Iterators and collections",
      "\\b(iter|into_iter|map|filter|collect|sum|Vec)\\b|\\[",
      "iter() usually borrows a collection and yields references to its items. Iterator adapters such as map are lazy until consumed. sum combines items into a total, while collect builds a collection from the produced items.",
      "iter() aam taur par collection ko borrow karke items ke references deta hai. map jaise iterator adapters consume hone tak lazy rehte hain. sum items ko total mein jodta hai aur collect produced items se collection banata hai."
    ],
    [
      "Loops and conditions",
      "\\b(for|while|loop|if|else|break|continue)\\b",
      "for consumes an iterable, while repeats while its condition is true, and loop repeats until control exits. break leaves the selected loop and continue skips to its next iteration. Explicit bounds and updates determine termination.",
      "for iterable par chalta hai, while true condition tak dohrata hai aur loop exit hone tak chalta rehta hai. break loop se bahar nikalta hai aur continue agli iteration par jata hai. Bounds aur updates loop ke rukne ka rasta tay karte hain."
    ]
  ],
  "PHP": [
    [
      "Variables and comparisons",
      "\\$\\w+|===|==",
      "PHP variables start with $. = assigns, == compares using type conversion rules, and === compares both type and value. Do not treat assignment and comparison as interchangeable.",
      "PHP variable $ se shuru hota hai. = assignment karta hai, == conversion rules ke saath compare karta hai, aur === type aur value dono compare karta hai. Assignment aur comparison ek hi cheez nahi hain."
    ],
    [
      "Arrays and foreach",
      "\\[|\\b(array|foreach|array_sum)\\b",
      "A PHP array is an ordered map with integer or string keys; it can act as a list or a key-value collection. foreach can provide values or key-value pairs. array_sum adds array values that can be treated numerically.",
      "PHP array ordered map hai jisme integer ya string keys ho sakti hain; yeh list ya key-value collection ban sakti hai. foreach values ya key-value pairs deta hai. array_sum numerically treat ho sakne wali values ko jodta hai."
    ],
    [
      "Functions, output and references",
      "\\b(function|return|echo|print)\\b|&\\$",
      "function defines reusable code and return sends a value back to the caller. echo and print produce output. A parameter written with & is passed by reference, so changes can affect the caller variable.",
      "function reusable code banata hai aur return caller ko value lautata hai. echo aur print output dete hain. Parameter ke saath & ho toh reference se pass hota hai, isliye changes caller ke variable par asar kar sakte hain."
    ],
    [
      "Branches and loops",
      "\\b(if|else|elseif|for|while|break|continue)\\b",
      "Conditions choose which statements execute; loops repeat statements. Check updates and exit paths rather than assuming termination. In nested control structures, the optional numeric level on break or continue matters.",
      "Conditions chunti hain ki kaunsa code chalega; loops code dohrate hain. Updates aur exit paths dekhein, loop ke rukne ko maan na lein. Nested control mein break ya continue ka optional numeric level important hota hai."
    ]
  ],
  "Ruby": [
    [
      "Names and mutable objects",
      "\\b\\w+\\s*=",
      "Assignment binds a variable to an object. Assigning an array to another variable does not duplicate the array; both variables can refer to the same mutable object. Ruby integers do not have a fixed machine-size limit like a C int.",
      "Assignment variable ko object se jodta hai. Array ko doosre variable mein assign karne se alag array nahi banta; dono ek hi mutable object ko refer kar sakte hain. Ruby integers C int jaisi fixed machine-size limit tak bandhe nahi hote."
    ],
    [
      "Arrays, blocks and enumeration",
      "\\[|\\b(each|map|select|reduce|inject|sum|do)\\b",
      "Arrays are ordered sequences. each visits items, map creates transformed results, and reduce combines values. A block such as do...end supplies code to a method; a block is not itself proof that a new thread runs.",
      "Array ordered sequence hai. each items par chalta hai, map transformed results banata hai aur reduce values ko combine karta hai. do...end wala block method ko code deta hai; iska matlab apne aap naya thread chalna nahi hai."
    ],
    [
      "Methods and return values",
      "\\b(def|return|end|puts|print)\\b",
      "def defines a method. Methods normally return the last evaluated expression unless return exits earlier. puts writes output with line endings; print does not automatically add a newline. end closes constructs such as methods, classes and blocks.",
      "def method define karta hai. Method aam taur par last evaluated expression return karta hai, jab tak return pehle bahar na nikale. puts line ending ke saath output deta hai; print nayi line apne aap nahi jodta. end method, class ya block jaise construct ko band karta hai."
    ],
    [
      "Truthiness and nil",
      "\\b(if|unless|while|nil|false|true)\\b",
      "Only nil and false are falsey in Ruby. Zero and an empty string are truthy. nil represents an absent value; calling a missing method on nil usually raises NoMethodError.",
      "Ruby mein sirf nil aur false falsey hain. Zero aur khali string truthy hote hain. nil absent value dikhata hai; nil par missing method call karne se aam taur par NoMethodError milta hai."
    ]
  ],
  "SQL": [
    [
      "SELECT, FROM and WHERE",
      "\\b(select|from|where)\\b",
      "SELECT chooses result expressions, FROM chooses input tables, and WHERE filters individual rows. A query result is not guaranteed to be ordered unless ORDER BY specifies an order.",
      "SELECT result expressions chunta hai, FROM input tables chunta hai aur WHERE individual rows filter karta hai. ORDER BY ke bina result ka order guaranteed nahi hota."
    ],
    [
      "Grouping and aggregates",
      "\\b(group\\s+by|having|sum|count|avg|min|max)\\b",
      "GROUP BY forms groups. SUM, COUNT and AVG compute aggregate values; COUNT(*) counts rows while COUNT(column) ignores NULL values in that column. HAVING filters groups, unlike WHERE which filters rows.",
      "GROUP BY groups banata hai. SUM, COUNT aur AVG aggregate values nikalte hain; COUNT(*) rows ginta hai, jabki COUNT(column) us column ke NULL values nahi ginta. HAVING groups filter karta hai aur WHERE rows filter karta hai."
    ],
    [
      "Tables, inserts and changes",
      "\\b(create|insert|update|delete|drop)\\b",
      "CREATE TABLE defines a table and INSERT adds rows. UPDATE changes rows and DELETE removes rows; without WHERE they can affect every row. The runner uses a separate SQLite environment, not GrammarFlow's application database.",
      "CREATE TABLE table define karta hai aur INSERT rows jodta hai. UPDATE rows badalta hai aur DELETE unhein hatata hai; WHERE ke bina sabhi rows par asar ho sakta hai. Runner ka SQLite environment GrammarFlow ki app database se alag hai."
    ],
    [
      "Joins and NULL",
      "\\b(join|null|coalesce|is\\s+null)\\b",
      "A JOIN combines matching rows and can multiply results when keys repeat. LEFT JOIN keeps unmatched left rows with NULL right values. Use IS NULL to test missing values; = NULL does not behave like an ordinary equality test.",
      "JOIN matching rows jodta hai aur repeated keys par result rows badh sakti hain. LEFT JOIN unmatched left rows ko right side NULL ke saath rakhta hai. Missing value ke liye IS NULL use karein; = NULL normal equality test jaisa nahi chalta."
    ],
    [
      "Sorting and limits",
      "\\b(order\\s+by|limit|offset|asc|desc)\\b",
      "ORDER BY sorts results; ASC is ascending and DESC descending. LIMIT restricts the number of rows, but without a deterministic ORDER BY it does not identify a stable set of first rows.",
      "ORDER BY result sort karta hai; ASC ascending aur DESC descending order hai. LIMIT rows ki sankhya rokta hai, lekin deterministic ORDER BY ke bina stable first rows chunne ki guarantee nahi hoti."
    ]
  ]
};
function conceptGuide(text,label){
 const language=$('code-language').value;
 const matches=(conceptGuides[language]||[]).filter(item=>new RegExp(item[1],language==='SQL'?'i':'').test(text));
 $('concept-guide').hidden=!matches.length;$('concept-definitions').replaceChildren();
 $('concept-title').textContent='Related '+language+' concepts - '+label;
 for(const [name,pattern,english,hinglish]of matches){addText($('concept-definitions'),'dt',name);addText($('concept-definitions'),'dd',$('language').value==='Hinglish'?hinglish:english);}
}

function executionAvailable(){return !!$('code').value.trim()&&$('code').value.length<=60000&&$('code').value.split('\n').length<=1000;}
async function runRemote(code,inputs,signal){
 const response=await fetch('/execute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,inputs,codeLanguage:$('code-language').value}),signal});
 const body=await response.json();if(!response.ok||!body.success)throw Error(body.error?.message||'The external code runner is unavailable.');
 const result=body.data;if(!result||typeof result.stdout!=='string'||typeof result.stderr!=='string'||typeof result.compileOutput!=='string')throw Error('Invalid execution result.');
 return {meta:{language:result.language,executionKind:'remote',truncated:result.outputMayBeTruncated,stopReason:result.error?'error':null,executionMs:result.executionMs},steps:[],stdout:result.stdout,stderr:result.stderr,compileOutput:result.compileOutput,error:result.error};
}
function rangePreview(){
 const lines=$('code').value.split('\n'),start=Number($('range-start').value),valid=Number.isInteger(start)&&start>=1&&start<=lines.length;
 $('range-start').max=lines.length;$('line-batch').disabled=!valid;
 $('range-prev').disabled=!valid||start===1;$('range-next').disabled=!valid||start+10>lines.length;
 $('line-batch').textContent=valid?`Explain lines ${start}–${Math.min(start+9,lines.length)}`:'Choose a starting line';
 $('range-preview').textContent=valid?lines.slice(start-1,start+9).map((line,i)=>`${start+i}  ${line}`).join('\n'):'Choose a valid starting line.';
 conceptGuide(valid?lines.slice(start-1,start+9).join('\n'):'',valid?'lines '+start+'-'+Math.min(start+9,lines.length):'selection');
}
function executionControls(){
 const python=$('code-language').value==='Python';
 $('run').disabled=!executionAvailable();$('example').disabled=!python;$('example').hidden=!python;$('inputs').disabled=false;$('try-error').disabled=!python;$('try-error').hidden=!python;
 const local=python&&$('code').value.length<=12000;
 $('execution-help').textContent=local?'Python runs on your device: 500 recorded steps and a 3-second execution limit. Longer programs run on Judge0.':'Run sends this code and test inputs to Judge0 for compilation/execution. Do not include secrets. Single-file programs only; Java needs class Main. Remote runs show real output/errors, not variable snapshots.';
 $('empty-help').textContent=local?'Run Python for real snapshots, or use line-by-line source explanations below.':'Run your code for real output and errors, then explore the source line by line below. Remote execution does not record variable snapshots.';
 $('run').textContent=local?'Run & explore':'Run on Judge0';
}

function pause(){clearInterval(playing);playing=null;$('play').textContent='Play';}
function addText(parent,tag,text,className){const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;parent.append(el);return el;}
export function narrate(step,hinglish=false){
    const where=step.causedBy==null?'':hinglish?`Line ${step.causedBy} ke baad: `:`Since line ${step.causedBy}: `;
    const changes=step.changed.filter(name=>name!=='input').slice(0,4).map(name=>`${name} = ${step.vars[name]}`).join('; ');
    if(step.event==='exception')return hinglish?`${step.exception} exception aaya. Yeh handle bhi ho sakta hai; final result neeche dekho.`:`A ${step.exception} exception occurred. It may be handled; check the final result below.`;
    if(step.event==='return')return (step.stack.length===1&&step.stack[0]==='<module>'?
        (hinglish?'Code ka execution yahan khatam hua. ':'Code execution ended here. '):
        (hinglish?'Yeh function ab return kar raha hai. ':'This function is returning. '))+(changes?where+changes:'');
    return where+(changes?(hinglish?'Values badli hain: ':'Values changed: ')+changes+'. ':'')+
        (step.event==='call'?(hinglish?'Function mein enter kar rahe hain.':'Entering this frame.'):
        hinglish?`Ab line ${step.line} chalegi.`:`About to run line ${step.line}.`);
}
function lineOptions(){
    updateLineNumbers();
    const lines=$('code').value.split('\n');$('why-line').max=lines.length;
    const selected=Number($('why-line').value);
    if(!Number.isInteger(selected)||selected<1||selected>lines.length)$('why-line').value='1';
    linePreview();rangePreview();
}
function updateLineNumbers(){
    const count=$('code').value.split('\n').length;
    $('code-line-numbers').textContent=Array.from({length:count},(_,index)=>index+1).join('\n');
    $('code-line-count').textContent=`${count} / 1,000 lines · ${$('code').value.length.toLocaleString()} / 60,000 characters`;
    $('code-gutter').scrollTop=$('code').scrollTop;
}
$('code').onscroll=()=>{$('code-gutter').scrollTop=$('code').scrollTop;};
function linePreview(){
    const line=Number($('why-line').value),text=$('code').value.split('\n')[line-1];
    const valid=Number.isInteger(line)&&line>=1&&typeof text==='string'&&!!text.trim();
    $('why').disabled=!valid;$('why').textContent=valid?`Explain line ${line}`:'Explain line';
    $('selected-source').textContent=valid?`${line}  ${text}`:'Choose a valid non-empty line.';
    conceptGuide(valid?text:'','line '+line);
    return valid;
}
function render(followLine=true){
    if(!trace)return;const remote=trace.meta.executionKind==='remote';const step=trace.steps[position];
    $('recording-kind').textContent=remote?'REAL PROGRAM RESULT - '+trace.meta.language:'RECORDED EXECUTION';
    $('remote-diagnostics').hidden=!remote;
    $('remote-stderr').textContent=trace.stderr||'(none)';$('remote-compile').textContent=trace.compileOutput||'(none)';$('empty').hidden=true;$('trace-view').hidden=false;
    if(followLine&&step?.line>0)$('why-line').value=String(step.line);
    $('python-details').hidden=remote;$('timeline-controls').hidden=remote;linePreview();$('fix').disabled=false;
    $('fix-help').textContent=trace.error?`Captured ${trace.error.type}. Click Fix my error to explain it and suggest a correction.`:'No error was captured. Edit your code and run again to investigate a failure.';
    $('step-label').textContent=remote?'Output and diagnostics':step?`${position+1} / ${trace.steps.length}`:'No recorded steps';
    $('timeline').max=Math.max(0,trace.steps.length-1);$('timeline').value=position;
    $('prev').disabled=!step||position===0;$('next').disabled=!step||position===trace.steps.length-1;$('play').disabled=!step;
    $('lines').replaceChildren();source.split('\n').forEach((text,index)=>{const row=addText($('lines'),'button','','code-line'+(step?.line===index+1?' active':''));row.type='button';row.title=`Select line ${index+1} for explanation`;row.setAttribute('aria-label',`Select line ${index+1}: ${text}`);row.onclick=()=>{$('why-line').value=String(index+1);$('why-line').onchange();$('why').focus();};addText(row,'span',String(index+1),'line-number');row.append(document.createTextNode(text));});
    $('lines').querySelector('.active')?.scrollIntoView({block:'nearest'});
    $('narration').textContent=step?narrate(step,$('language').value==='Hinglish'):remote?'This is real execution output from Judge0. Use Explain line or line-by-line explanations to explore the source; no variable trace was recorded.':'Execution ended before a snapshot was recorded.';
    $('variables').replaceChildren();$('array-view').replaceChildren();$('variable-detail').textContent='';
    for(const [name,value]of Object.entries(step?.vars||{})){
        if(name==='input')continue;
        const button=addText($('variables'),'button',`${name}  ${value}`,step.changed.includes(name)?'changed':'');
        button.onclick=()=>{const earlier=trace.steps.slice(0,position).reverse().find(s=>JSON.stringify(s.stack)===JSON.stringify(step.stack)&&name in s.vars);$('variable-detail').textContent=`${name}: ${earlier?.vars[name]??'not previously recorded'} → ${value}. `+(step.changed.includes(name)?`Observed since line ${step.causedBy??'entry'}.`:'No recorded change at this step.');};
        // Display only unambiguous flat numeric lists; never evaluate Python text.
        if(/^\[\s*(-?\d+(?:\.\d+)?\s*(,\s*-?\d+(?:\.\d+)?\s*)*)?\]$/.test(value)){
            const values=value.slice(1,-1).split(',').map(x=>x.trim()).filter(Boolean).slice(0,30);
            addText($('array-view'),'p',name,'array-name');const cells=addText($('array-view'),'div','','array-cells');
            values.forEach((v,i)=>{const cell=addText(cells,'div',v,'array-cell');addText(cell,'small',String(i));});
        }
    }
    $('stack').textContent=step?.stack.join(' → ')||'—';$('stdout').textContent=(remote?trace.stdout:step?.stdout)||(remote?'(program produced no output)':'(no output yet)');
    $('error').textContent=trace.error?`${trace.error.type}: ${trace.error.message}`:'';
    $('limits').textContent=remote?'Single-file execution on Judge0 with time, memory and output limits. Stop stops waiting; a submitted job may finish remotely. '+(trace.meta.truncated?'Output may be truncated.':''):(trace.meta.truncated?`Partial trace — ${trace.meta.stopReason}. `:'')+'Snapshots show state before each line; a changed value belongs to the preceding observed line in that frame.';
}
$('example').onchange=()=>{$('code').value=examples[$('example').value];invalidate();};
function invalidate(){pause();aiController?.abort();trace=null;$('range-start').value='1';lineOptions();executionControls();$('trace-view').hidden=true;$('empty').hidden=false;$('fix').disabled=false;$('fix-help').textContent='Run the code to capture a compiler or runtime error first.';$('ai-result').hidden=true;$('ai-state').textContent='';$('run-state').textContent=executionAvailable()?'Code changed. Run again for a fresh trace.':'Use up to 1,000 lines / 60,000 characters to run or explain code.';}
$('try-error').onclick=()=>{$('example').value='error';$('code').value=examples.error;invalidate();$('run-state').textContent='Error example loaded. Click Run & explore; then use Fix my error.';$('run').focus();};
$('code').oninput=$('inputs').oninput=invalidate;
$('code-language').onchange=()=>{invalidate();$('run-state').textContent=executionAvailable()?'Ready to run. Check where execution happens above.':'Use up to 1,000 lines / 60,000 characters.';};
$('load-language-example').onclick=()=>{$('code').value=languageExamples[$('code-language').value];invalidate();};
$('range-start').oninput=()=>{aiController?.abort();$('ai-result').hidden=true;$('ai-state').textContent='Range changed. Click Explain lines to request an answer.';rangePreview();};
$('range-prev').onclick=()=>{$('range-start').value=Math.max(1,Number($('range-start').value)-10);$('range-start').oninput();};
$('range-next').onclick=()=>{$('range-start').value=Math.min($('code').value.split('\n').length,Number($('range-start').value)+10);$('range-start').oninput();};
$('line-batch').onclick=()=>assist('lines');
$('language').onchange=()=>{aiController?.abort();$('ai-result').hidden=true;$('ai-state').textContent='';render(false);rangePreview();};
$('why-line').onchange=()=>{
    pause();aiController?.abort();$('ai-result').hidden=true;$('ai-state').textContent='';
    if(!linePreview()){$('line-help').textContent='Enter a non-empty line number within your code.';return;}
    const line=Number($('why-line').value);
    const matches=trace?.steps.map((step,index)=>({step,index})).filter(item=>item.step.line===line&&item.step.event==='line')||[];
    const match=matches.find(item=>item.index>=position)||matches[0];
    if(match){position=match.index;render(false);}
    $('line-help').textContent=match?`Line ${line} selected at recorded step ${match.index+1}. Click Explain line ${line} to get an answer.`:`Line ${line} selected. Click Explain line ${line} for a source-only explanation; no recorded execution is available.`;
};
$('why-line').oninput=()=>{aiController?.abort();$('ai-result').hidden=true;linePreview();$('ai-state').textContent='Line selection changed. Click Explain line to request its explanation.';};
$('why-line').onkeydown=event=>{if(event.key==='Enter'&&!$('why').disabled){event.preventDefault();assist('why');}};
$('cursor-line').onclick=()=>{$('why-line').value=String($('code').value.slice(0,$('code').selectionStart).split('\n').length);$('why-line').onchange();};
$('timeline').oninput=()=>{pause();position=Number($('timeline').value);render();};
$('prev').onclick=()=>{pause();position=Math.max(0,position-1);render();};
$('next').onclick=()=>{pause();position=Math.min(trace.steps.length-1,position+1);render();};
$('play').onclick=()=>{if(playing){pause();return;}if(position>=trace.steps.length-1)position=0;$('play').textContent='Pause';playing=setInterval(()=>{render();if(position>=trace.steps.length-1)pause();else position++;},650);};
$('stop').onclick=()=>controller?.abort();
$('run').onclick=async()=>{
    if(!executionAvailable()){$('run-state').textContent='Use up to 1,000 lines / 60,000 characters to run code.';return;}
    $('code-language').disabled=$('load-language-example').disabled=true;
    pause();aiController?.abort();controller=new AbortController();source=$('code').value;trace=null;$('why').disabled=$('fix').disabled=true;
    $('trace-view').hidden=true;$('empty').hidden=false;$('ai-result').hidden=true;$('ai-state').textContent='';pause();
    $('prev').disabled=$('next').disabled=$('play').disabled=$('timeline').disabled=true;
    $('run').disabled=true;$('why-line').disabled=true;$('try-error').disabled=true;$('stop').disabled=false;$('code').readOnly=true;$('example').disabled=true;$('inputs').readOnly=true;$('run-state').textContent=$('code-language').value==='Python'&&source.length<=12000?'Loading Python and recording...':'Compiling/running on Judge0...';
    try{const inputs=$('inputs').value?$('inputs').value.split('\n'):[];trace=$('code-language').value==='Python'&&source.length<=12000?await run(source,inputs,{signal:controller.signal}):await runRemote(source,inputs,controller.signal);position=0;render();$('run-state').textContent=`${trace.meta.stopReason||'Completed'} · ${trace.meta.executionKind==='remote'?'remote result':trace.steps.length+' steps'} · ${trace.meta.executionMs??'?'} ms execution`;}
    catch(error){$('run-state').textContent=error.name==='AbortError'?'Stopped waiting. A submitted remote job may still finish.':error.message;}
    finally{$('code-language').disabled=$('load-language-example').disabled=false;executionControls();$('why-line').disabled=false;$('why').disabled=!$('why-line').value;$('try-error').disabled=false;$('fix').disabled=false;$('stop').disabled=true;$('code').readOnly=false;$('example').disabled=false;$('inputs').readOnly=false;$('timeline').disabled=false;}
};
async function assist(mode){
    if(mode==='error'&&!trace?.error){$('ai-state').textContent='No captured error to fix yet. Click Load an error example, then Run & explore. No AI request was sent.';return;}
    const code=$('code').value;if(!code.trim())return;
    if(code.length>60000||code.split('\n').length>1000||code.split('\n').some(line=>line.length>1000)){$('ai-state').textContent='Use up to 1,000 lines / 60,000 characters, with up to 1,000 characters per line.';return;}
    const rangeStart=Number($('range-start').value);
    if(mode==='lines'&&(!Number.isInteger(rangeStart)||rangeStart<1||rangeStart>code.split('\n').length)){$('ai-state').textContent='Choose a valid starting line.';return;}
    const selectedLine=Number($('why-line').value);
    if(mode==='why'&&(!Number.isInteger(selectedLine)||selectedLine<1||!code.split('\n')[selectedLine-1]?.trim())){$('ai-state').textContent='Choose a non-empty line to explain.';return;}
    const step=trace?.steps[position]?.line===selectedLine?trace.steps[position]:undefined;
    const payload={code,mode,codeLanguage:$('code-language').value,...(mode==='lines'?{rangeStart}:{}),language:$('language').value,...(mode==='why'?{selectedLine}:{}),steps:(mode==='why'?[step]:trace?.steps.filter(s=>s.changed.length||s.event==='exception').slice(-12)||[]).filter(Boolean).map(s=>({line:s.line,event:s.event,changed:s.changed,vars:Object.fromEntries(Object.entries(s.vars).filter(([name])=>s.changed.includes(name))),causedBy:s.causedBy})),error:trace?.error||null};
    aiController?.abort();
    const key=JSON.stringify(payload);if(aiCache.has(key)){$('ai-result').hidden=false;$('ai-result').textContent=aiCache.get(key);$('ai-state').textContent='Reused this explanation. No new AI request.';return;}
    aiController=new AbortController();const requestController=aiController;$('ai-state').textContent=mode==='lines'?`Explaining lines ${rangeStart}–${Math.min(rangeStart+9,code.split('\n').length)}…`:mode==='why'?`Explaining line ${selectedLine}…`:'Requesting an explanation…';$('ai-result').hidden=true;$('ai-state').scrollIntoView({block:'nearest'});
    try{const response=await fetch('/assist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:requestController.signal});const data=await response.json();if(requestController.signal.aborted)return;if(!response.ok||!data.success)throw Error(data.error?.message||'Explanation unavailable. Your local trace still works.');if(aiCache.size>=20)aiCache.delete(aiCache.keys().next().value);aiCache.set(key,data.data);$('ai-result').hidden=false;$('ai-result').textContent=data.data;$('ai-state').textContent=data.source==='local'?'Blank lines labelled without calling the AI provider.':mode==='lines'?'AI source explanation — selected lines only; no code was executed.': 'AI interpretation — verify important claims against your code and tests.';}
    catch(error){if(error.name!=='AbortError')$('ai-state').textContent=error.message;}
}
$('explain').onclick=()=>assist('explain');$('why').onclick=()=>assist('why');$('fix').onclick=()=>assist('error');
lineOptions();executionControls();
