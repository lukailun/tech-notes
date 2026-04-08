# Swift 内存

## 值类型 & 引用类型

* 值类型（Value Type）：结构体（Struct）、枚举（Enum）、函数（Function）、非逃逸闭包（Non-escaping Closure）。
* 引用类型（Reference Type）：类（Class）、参与者（Actor）、逃逸闭包（Escaping Closure）。

## 栈 & 堆

Swift 中两种核心内存分配方式，由编译器自动根据数据类型决定使用。

* 栈（Stack）：运行时可预测分配，采用后进先出（LIFO）机制。
* 堆（Heap）：运行时动态分配，需通过自动引用计数（ARC）管理内存，机制复杂。

## `MemoryLayout`

`MemoryLayout` 是 Swift 中查询类型内存布局的工具，可以使用它查询任意类型的 `size`，`stride`，`alignment`。

```swift
@frozen public enum MemoryLayout<T> : ~BitwiseCopyable, Copyable, Escapable where T : ~Copyable, T : ~Escapable {
  public static var size: Int { get }
  public static var stride: Int { get }
  public static var alignment: Int { get }
}
```

* `size`：大小，类型实例自身占用的字节数，不包含其管理的堆内存。
* `stride`：步长，类型实例实际分配的字节数。因为内存对齐补齐，所以 stride 一定大于等于 size。
* `alignment`：对齐，内存对齐基数。

## 基础类型

* `Int`：64 位系统整数，8 字节。
* `Double`：64 位浮点数，8 字节。
* `Bool`：只存储 `true`/`false`，固定占用 1 字节。

```swift
MemoryLayout<Int>.size // 8
MemoryLayout<Double>.size // 8
MemoryLayout<Bool>.size // 1
```

## 字符串类型

* `String`：变量自身固定占用 16 字节。对齐要求为 8 字节。

```swift
MemoryLayout<String>.size // 16
MemoryLayout<String>.alignment // 8
```

变量自身永远在栈，内容位置由长度决定：短字符串（UTF-8 字节数小于等于 15）内容直接存在栈，长字符串（UTF-8 字节数大于 15）内容存在堆。可以使用 `utf8.count` 查看字符串实际内容占用的字节数。

```swift
// 短字符串：内容直接存在栈上的 16 字节内部
let shortString = "Hello Swift"
MemoryLayout.size(ofValue: shortString) // 16
shortString.utf8.count // 11

// 长字符串：内容存在堆上，变量只持有堆指针
let longString = "Hello Swift! This is a very long text string."
MemoryLayout.size(ofValue: longString) // 16
longString.utf8.count // 45
```

## 集合类型

* `Array`：变量自身固定占用 8 字节。
* `Dictionary`：变量自身固定占用 8 字节。
* `Set`：变量自身固定占用 8 字节。

```swift
MemoryLayout<Array<Any>>.size // 8
MemoryLayout<Array<String>>.size // 8
MemoryLayout<Array<Bool>>.size // 8

MemoryLayout<Dictionary<AnyHashable, Any>>.size // 8
MemoryLayout<Dictionary<String, Int>>.size // 8
MemoryLayout<Dictionary<Int, Bool>>.size // 8

MemoryLayout<Set<Any>>.size // 8
MemoryLayout<Set<String>>.size // 8
MemoryLayout<Set<Bool>>.size // 8
```

变量自身永远在栈，真实数据存在堆，栈上仅存储指向堆内存的指针。

## 结构体类型

结构体是值类型，内容直接存在栈。内存大小由成员总和与对齐规则决定。

```swift
struct Point {
  let x: Double // 8
  let y: Double // 8
  let isFilled: Bool // 1
}

MemoryLayout<Point>.size // 17
MemoryLayout<Point>.stride // 24
MemoryLayout<Point>.alignment // 8
```

* `size`：所有成员实际占用字节之和，`Double`(8) + `Double`(8) + `Bool`(1) = 17，不包含填充字节。
* `stride`：按照对齐规则 8 对齐，17 向上取 8 的最小倍数为 24，包含填充字节。
* `alignment`：取结构体内最大成员的对齐值，`Double` 对齐为 8。

## 类类型

类是引用类型，内容存在堆。栈上只存储 8 字节堆指针，与成员数量无关。可以使用 `class_getInstanceSize` 查看类实例在堆中实际占用的字节数。

```swift
class Vehicle {
  var speed: Int
  var isRunning: Bool
  init(speed: Int, isRunning: Bool) {
    self.speed = speed
    self.isRunning = isRunning
  }
}

MemoryLayout<Vehicle>.size // 8
MemoryLayout<Vehicle>.stride // 8
MemoryLayout<Vehicle>.alignment // 8

class_getInstanceSize(Vehicle.self) // 32
```

* `size`：类在栈上只存储堆地址指针，固定 8 字节。
* `stride`：指针大小为 8，已满足对齐，无需填充。
* `alignment`：指针类型对齐为 8。

## 枚举类型

枚举是值类型，内容直接存在栈。无关联值的枚举固定占用 1 字节，有关联值时大小由最大关联值决定。

```swift
enum Direction {
  case up, down, left, right
}

MemoryLayout<Direction>.size // 1
```

* `size`：无关联值枚举，固定占用 1 字节。

```swift
enum Result {
  case success(Int)
  case failure(String)
}

MemoryLayout<Result>.size // 17
MemoryLayout<Result>.stride // 24
MemoryLayout<Result>.alignment // 8
```

* `size`：最大关联值 `String`(16) + 标签字节(1) = 17，不包含填充字节。
* `stride`：按照对齐规则 8 对齐，17 向上取 8 的最小倍数为 24，包含填充字节。
* `alignment`：取关联值中最大对齐值，`String` 对齐为 8。

## 可选类型

`Optional` 本质是枚举，属于值类型，存储在栈。

```swift
@frozen public enum Optional<Wrapped> : ~Copyable, ~Escapable where Wrapped : ~Copyable, Wrapped : ~Escapable {
  case none
  case some(Wrapped)
}
```

```swift
MemoryLayout<Int?>.size // 9
MemoryLayout<Int?>.stride // 16
MemoryLayout<Int?>.alignment // 8
```

* `size`：原始类型 `Int`(8) + 标签字节(1) = 9，不包含填充字节。
* `stride`：按照对齐规则 8 对齐，9 向上取 8 的最小倍数为 16，包含填充字节。
* `alignment`：取原始类型的对齐值，`Int` 对齐为 8。

## 参与者类型

参与者是引用类型，内容存在堆。栈上只存储 8 字节堆指针，与成员数量无关。可以使用 `class_getInstanceSize` 查看参与者实例在堆中实际占用的字节数。`Actor` 底层为了实现并发安全与数据隔离，内置专门的运行时机制，因此堆内存占用远大于普通 `Class`。

```swift
actor Counter {
  var value = 0
}

MemoryLayout<Counter>.size // 8
MemoryLayout<Counter>.stride // 8
MemoryLayout<Counter>.alignment // 8

class_getInstanceSize(Counter.self) // 120
```

* `size`：参与者在栈上只存储堆地址指针，固定 8 字节。
* `stride`：指针大小为 8，已满足对齐，无需填充。
* `alignment`：指针类型对齐为 8。