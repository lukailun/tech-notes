# Protocol 与 Dispatch

## Protocol 基础

协议是 Swift 实现多态的核心方式，支持 Class 和 Struct。Struct 不支持继承，但通过协议的抽象和遵循可实现类似功能。

### 默认实现

协议扩展可提供默认实现，遵循类型无需重复编写。

```swift
protocol Decoder {
  func decode()
}

extension Decoder {
  func decode() {
    print("Some Default Decoding")
  }
}

struct DefaultDecoder: Decoder {}

DefaultDecoder().decode() // "Some Default Decoding"
```

### 条件遵循

类型仅在满足特定条件时遵循协议。

```swift
protocol Summable {
  func sum() -> Int
}

extension Array: Summable where Element == Int {
  func sum() -> Int {
    return self.reduce(0, +)
  }
}

let numbers = [1, 2, 3, 4, 5]
numbers.sum() // 15
```

## Dispatch

Dispatch 是 Swift 决定调用哪个具体方法实现的机制。Swift 有五种 Dispatch 方式：

| 类型 | 速度 | 场景 |
|------|------|------|
| Static Dispatch | 最快 | 值类型、final 类/方法、private/fileprivate/static 方法 |
| V-Table Dispatch | 快 | Class 继承、可重写方法 |
| Protocol Witness Table | 中等 | 通过协议类型变量调用必需方法 |
| Message Dispatch | 最慢 | @objc、#selector、KVO、Method Swizzling |

### Static Dispatch

编译期确定调用目标，可内联优化，消除间接调用开销。

```swift
struct Size {
  var width, height: Double
  func area() -> Double {
    return width * height
  }
}
Size(width: 10, height: 10).area() // Static Dispatch
```

```swift
final class Size {
  var width, height: Double
  func area() -> Double {
    return width * height
  }
}
// 或 class Size { final func area() ... }
Size(width: 10, height: 10).area() // Static Dispatch
```

协议扩展中的默认实现（非协议必需方法）也使用 Static Dispatch：

```swift
protocol Animal {}
extension Animal {
  func sleep() {
    print("Sleeping soundly.")
  }
}

struct Dog: Animal {}
let animal: Animal = Dog()
animal.sleep() // Static Dispatch
```

### V-Table Dispatch

Class 有虚函数表（v-table），存储方法指针。子类重写方法时更新 v-table 对应条目。调用时通过运行时类型查找 v-table 获取正确实现。

```swift
class Animal {
  func sleep() { print("Sleeping...") }
}

class Dog: Animal {
  override func sleep() { print("Dog is sleeping.") }
}

let animal: Animal = Dog()
animal.sleep() // V-Table Dispatch
```

Class 的 `static func` 隐式 final，使用 Static Dispatch；`class func` 可被子类重写，使用 V-Table Dispatch。

```swift
class Vehicle {
  static func vehicleType() -> String { return "Generic Vehicle" }
  class func maxSpeed() -> Int { return 100 }
}

class Car: Vehicle {
  override class func maxSpeed() -> Int { return 250 }
}

Car.vehicleType() // "Generic Vehicle" — Static Dispatch
Car.maxSpeed()    // 250 — V-Table Dispatch
```

### Protocol Witness Table（PWT）

通过协议类型变量调用必需方法时，Swift 使用 PWT Dispatch。编译期创建 witness table，存储具体类型提供的方法实现指针。

```swift
protocol Animal {
  func sleep()
}

class Dog: Animal {
  func sleep() { print("Dog is sleeping.") }
}

let animal: Animal = Dog() // 协议类型变量
animal.sleep() // PWT Dispatch
```

赋值给协议类型变量时，Swift 创建 Existential Container，包含：
* 值本身
* 具体类型元数据指针
* Protocol Witness Table 指针

若使用具体类型变量，则退回 V-Table Dispatch：

```swift
let animal: Dog = Dog()
animal.sleep() // V-Table Dispatch
```

### Message Dispatch

通过 Objective-C 运行时实现，支持 `#selector`、Method Swizzling、KVO。

```swift
class ViewController: UIViewController {
  override func viewDidLoad() {
    super.viewDidLoad()
    let button = UIButton()
    button.addTarget(self, action: #selector(buttonAction), for: .touchUpInside)
  }

  @objc func buttonAction() { }
}
```

`@objc` 标记的方法对 Objective-C 运行时可见。`dynamic` 关键字强制使用 Message Dispatch：

```swift
class ViewModel: NSObject {
  @objc dynamic var value: String // 强制 Message Dispatch
}
```

### Dispatch 流程

* 值类型 / final / static / private → **Static Dispatch**
* Class 可重写方法 → **V-Table Dispatch**
* 协议类型变量调用必需方法 → **PWT Dispatch**
* @objc / dynamic → **Message Dispatch**

## Existential Type（any）

Existential 是使用 `any Protocol` 作为类型的协议，本质是类型擦除。编译期隐藏具体类型，运行时通过 Existential Container 和 PWT 调用方法。

```swift
protocol Logger {
  func log(_ message: String)
}

struct ConsoleLogger: Logger {
  func log(_ message: String) { print("Console: \(message)") }
}

struct FileLogger: Logger {
  func log(_ message: String) { print("File: \(message)") }
}

func runLogger(_ logger: any Logger) {
  logger.log("Hello")
}
```

### 存在 associatedtype 时

Existential 会擦除 associatedtype 信息，无法直接调用依赖 associatedtype 的方法：

```swift
protocol Logger {
  associatedtype Message
  func log(_ message: Message)
}

func testLogger(_ logger: any Logger) {
  logger.log("Hello") // 编译错误：Message 类型被擦除
}
```

解决方式：
* 使用泛型保留类型信息：`func testLogger<T: Logger>(_ logger: T, message: T.Message)`
* 手动类型擦除（如 `AnyLogger` 包装器）

## Opaque Type（some）

`some` 隐藏具体类型但编译器仍知道，可跳过 Existential Container 生成更优化的代码。

```swift
func makeLogger() -> some Logger {
  ConsoleLogger()
}
```

### some vs any

| 特性 | some | any |
|------|------|-----|
| Existential Container | 不使用，编译器知道类型 | 始终使用 |
| 主要用途 | 隐藏 API 返回的具体类型 | 存储不同类型到异构集合 |
| 额外间接层 | 无 | 有 |
| 内存布局 | 编译期固定 | 编译期未知 |
| Dispatch | 可内联/Static/V-Table | PWT Dispatch |

## Generics vs Existential

* 泛型：编译期解析，编译器生成特化版本，避免装箱开销
* Existential：运行时解析，使用 Existential Container

```swift
protocol Animal {
  func sleep()
}

class Dog: Animal {
  func sleep() { print("Dog is sleeping.") }
}

// 泛型：编译期知道具体类型
func makeItSleep<T: Animal>(_ animal: T) {
  animal.sleep()
}

// Existential：运行时解析
func makeItSleep(_ animal: any Animal) {
  animal.sleep()
}
```

## Protocol Composition

使用 `&` 组合多个协议，要求类型同时遵循所有协议。

```swift
protocol Flyable { func fly() }
protocol Swimmable { func swim() }

struct Duck: Flyable, Swimmable {
  func fly() { print("Flapping wings!") }
  func swim() { print("Paddling in the pond!") }
}

func makeItMove(_ creature: Flyable & Swimmable) {
  creature.fly()
  creature.swim()
}

makeItMove(Duck())
// "Flapping wings!"
// "Paddling in the pond!"
```

## 常见陷阱

### 协议扩展中的默认实现

协议必需方法 → 遵循类型的实现优先。协议扩展中的非必需方法 → 使用扩展版本，即使遵循类型提供了实现。

```swift
// 情况 1：greet 是协议必需方法
protocol Greeter {
  func greet()
}
extension Greeter {
  func greet() { print("Hello from default!") }
}
struct Person: Greeter {
  func greet() { print("Hello from Person!") }
}

let greeter: Greeter = Person()
greeter.greet() // "Hello from Person!" — 遵循类型实现优先

// 情况 2：greet 不是协议必需方法
protocol Greeter {}
extension Greeter {
  func greet() { print("Hello from default!") }
}
struct Person: Greeter {
  func greet() { print("Hello from Person!") }
}

let greeter: Greeter = Person()
greeter.greet() // "Hello from default!" — 使用扩展版本
```

### 引导编译器

优先使用 `some` 而非 `any`，让编译器保留类型信息进行优化：

```swift
// 避免
func makeLogger() -> any Logger {
  ConsoleLogger()
}

// 推荐
func makeLogger() -> some Logger {
  ConsoleLogger()
}
```
