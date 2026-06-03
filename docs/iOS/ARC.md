# ARC

## ARC 基础

ARC（Automatic Reference Counting）是 Swift 对引用类型（Class、Actor）的内存管理系统。每次创建对实例的新引用，ARC 递增存储在堆中的引用计数；引用移除时递减。计数归零时，Swift 释放实例并回收内存。

* 引用创建 → 引用计数 +1（retain）
* 引用销毁（如变量离开作用域）→ 引用计数 -1（release）
* 引用计数归零 → 释放实例
* 多线程环境下，retain/release 使用原子操作保证线程安全，但会带来一定性能开销

## Retain Cycle

Retain Cycle（强引用循环）：两个或多个对象互相持有强引用，形成循环，导致无法释放。这是常见的内存泄漏。

Swift 提供 `weak` 和 `unowned` 两个关键字打破循环。

* `weak`：不增加引用计数，引用必须声明为 `Optional`，被引用实例随时可能变为 `nil`
* `unowned`：不增加引用计数，假定被引用实例在引用生命周期内始终存在，声明为非 `Optional`，若实例已释放则访问时崩溃

### weak 示例

```swift
class Person {
  var name: String
  var pet: Pet?
  init(name: String) {
    self.name = name
  }
  deinit {
    print("\(name) is being deallocated")
  }
}

class Pet {
  var name: String
  weak var owner: Person? // weak 打破循环
  init(name: String) {
    self.name = name
  }
  deinit {
    print("\(name) is being deallocated")
  }
}

var john: Person? = Person(name: "John")
var dog: Pet? = Pet(name: "Buddy")
john?.pet = dog
dog?.owner = john
john = nil // "John is being deallocated"
dog = nil  // "Buddy is being deallocated"
```

### unowned 示例

```swift
class Customer {
  let name: String
  var card: CreditCard?
  init(name: String) {
    self.name = name
  }
  deinit {
    print("\(name) is being deallocated")
  }
}

class CreditCard {
  let number: UInt64
  unowned let customer: Customer // customer 始终拥有 card
  init(number: UInt64, customer: Customer) {
    self.number = number
    self.customer = customer
  }
  deinit {
    print("Card #\(number) is being deallocated")
  }
}

var alice: Customer? = Customer(name: "Alice")
alice?.card = CreditCard(number: 1234_5678_9012_3456, customer: alice!)
alice = nil // "Alice is being deallocated" + "Card #1234567890123456 is being deallocated"
```

## 闭包中的 Retain Cycle

闭包捕获 `self` 时也可能造成 Retain Cycle，尤其是逃逸闭包。

### 有 Retain Cycle

```swift
class ViewModel {
  var name = "Steve"
  var onUpdate: (() -> Void)?
  func setup() {
    onUpdate = {
      print(self.name) // 强引用 self
    }
  }
  deinit {
    print("ViewModel deinitialized")
  }
}

var vm: ViewModel? = ViewModel()
vm?.setup()
vm = nil // deinit 不会被调用，Retain Cycle
```

### 使用 weak 打破循环

```swift
func setup() {
  onUpdate = { [weak self] in
    print(self?.name ?? "nil")
  }
}
```

* `weak self`：self 可能为 nil，安全访问
* `unowned self`：确定 self 存活时使用，否则崩溃

### 不产生 Retain Cycle 的情况

```swift
class ViewModel {
  var onUpdate: (() -> Void)?
  func setup() {
    let name = "Steve"
    onUpdate = {
      print(name) // 捕获局部变量，不捕获 self
    }
  }
  deinit {
    print("ViewModel deinitialized")
  }
}

var viewModel: ViewModel? = ViewModel()
viewModel?.setup()
viewModel = nil // "ViewModel deinitialized"
```

## 委托中的 Retain Cycle

委托模式中，若 delegate 为强引用，容易产生 Retain Cycle。

### 有 Retain Cycle

```swift
protocol DownloaderDelegate: AnyObject {
  func downloadDidFinish()
}

class Downloader {
  var delegate: DownloaderDelegate? // 强引用！
  deinit {
    print("Downloader deinitialized")
  }
  func startDownload() {
    delegate?.downloadDidFinish()
  }
}

class ViewController: DownloaderDelegate {
  var downloader: Downloader?
  init() {
    downloader = Downloader()
    downloader?.delegate = self // 双向强引用
  }
  func downloadDidFinish() {
    print("Download finished")
  }
  deinit {
    print("ViewController deinitialized")
  }
}

var viewController: ViewController? = ViewController()
viewController = nil // 两个 deinit 都不会调用
```

### 使用 weak 修复

```swift
weak var delegate: DownloaderDelegate?
```

## Copy-on-Write

Copy-on-Write（写时复制）是 Swift 对 `Array`、`Dictionary`、`Set`、`Data`、`String` 等值类型的性能优化。

* 赋值时不立即复制底层数据，两个变量指向同一内存
* 只有当某个变量修改数据时，才创建副本

```swift
var array1 = [1, 2, 3]
var array2 = array1 // 未复制，共享底层 buffer
array2.append(4)    // 触发复制
```

底层机制：修改前检查 buffer 是否唯一引用（`isKnownUniquelyReferenced`）。唯一则直接修改，共享则复制后修改。

```swift
final class Buffer {
  var storage: [Int]
  init(_ storage: [Int]) {
    self.storage = storage
  }
}

var buffer1 = Buffer([1, 2, 3])
var buffer2 = buffer1
isKnownUniquelyReferenced(&buffer1) // false — 共享

buffer2 = Buffer(buffer2.storage) // 模拟 CoW
isKnownUniquelyReferenced(&buffer1) // true — 唯一
```

## 优化内存行为

### 值类型 vs 引用类型选择

* 追求可预测性和隔离性 → 值类型
* 需要身份标识和共享可变状态 → 引用类型
* 值类型配合 CoW 可避免不必要的内存复制

### 用 Struct 优化缓存 Key

```swift
// 优化前：String key，堆分配开销，类型不安全
var avatarCache = [String: UIImage]()
let cacheKey = "\(style)-\(mood)-\(accessory)"

// 优化后：Struct key，内联存储，编译期类型检查
struct AvatarConfiguration: Hashable {
  var style: AvatarStyle
  var mood: Mood
  var accessory: Accessory
}

var avatarCache = [AvatarConfiguration: UIImage]()
let cacheKey = AvatarConfiguration(style: style, mood: mood, accessory: accessory)
```

### 用 Enum 和 UUID 增强类型安全

```swift
// 优化前
struct Document {
  let path: URL
  let identifier: String   // 可传入任意字符串
  let fileType: String     // 可传入任意字符串
}

// 优化后
enum DocType: String {
  case pdf, docx, pages
}

struct Document {
  let path: URL
  let identifier: UUID     // 类型安全，更紧凑
  let fileType: DocType    // 编译期约束
}
```

### 减少 ARC 开销

* 不是所有场景都需要 Class，优先考虑 Struct 和 Enum
* 使用 `weak` / `unowned` 打破强引用循环
* 保持 Class 小而专注，减少 ARC 负担

## 调试工具

* **Instruments（Allocations & Leaks）**：Xcode 性能分析工具，追踪内存分配和泄漏
* **Memory Graph Debugger**：Xcode 内置工具，可视化展示 Retain Cycle，查看活跃实例和对象关系图
