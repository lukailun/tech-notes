# Swift 内存（行为篇）

> 接《Swift 内存》布局篇。本篇覆盖自动引用计数、循环引用、写时复制与优化实践，术语与布局篇保持一致（值本身 / 底层存储）。

## ARC（Automatic Reference Counting，自动引用计数）

* 作用对象：引用类型（`class`、`actor`）。值类型无需 ARC。
* 机制：每产生一个新的**强引用（strong reference）**，实例旁（堆上，与 `isa` 指针相邻）的引用计数 +1，称为 `retain`；引用销毁或离开作用域时 -1，称为 `release`；计数归零即释放实例、回收堆内存，触发 `deinit`（析构器）。
* 线程安全：并发场景下 `retain` / `release` 通常为**原子操作（atomic operation）**，保证计数准确，但带来微小性能开销。

```swift
class Node {
  var value: Int
  init(_ value: Int) { self.value = value }
  deinit { print("Node \(value) deinit") }
}

var a: Node? = Node(1)  // retain → count 1
var b = a              // retain → count 2
a = nil                // release → count 1，未归零，不 deinit
b = nil                // release → count 0，触发 deinit
```

> 注：引用计数与 `isa` 指针同处实例头部的 16 字节运行时元数据区（见布局篇「Class 内存布局」）。

## 循环引用（Retain Cycle / 强引用循环 / 保留环）

* 定义：两个及以上对象**互相持有强引用成环**，导致引用计数无法归零、实例永不释放——典型的内存泄漏。
* `weak` 与 `unowned` 用于打破环，二者**均不增加引用计数**：
  * `weak`（弱引用）：引用对象释放后自动置 `nil`，因此**必须声明为可选类型**；访问已释放对象安全。
  * `unowned`（无主引用）：假设引用对象在生命周期内始终存活，**非可选**；若对象已释放仍访问 → **运行时崩溃**。

### 场景一：对象互相引用

```swift
class Person {
  var pet: Pet?
  deinit { print("Person deinit") }
}
class Pet {
  weak var owner: Person?   // 弱引用打破环
  deinit { print("Pet deinit") }
}

var john: Person? = Person()
var dog = Pet()
john?.pet = dog
dog.owner = john
john = nil   // Person 可释放（dog.owner 为 weak，不阻止其释放）
```

> 若 `owner` 为强引用，`john = nil` 后 `Person` 仍被 `dog` 持有，形成保留环，双方 `deinit` 均不调用。

### 场景二：闭包捕获 self

* 逃逸闭包（escaping closure）会**强引用捕获 `self`**，若闭包又被实例长期持有（如存为属性），即成环。
* 现代 Swift 要求闭包内显式写 `self.`，仅为提醒捕获发生，**并不自动防环**。

```swift
class ViewModel {
  var name = "Steve"
  var onUpdate: (() -> Void)?
  func setup() {
    onUpdate = { [weak self] in        // 捕获列表打破环
      print(self?.name ?? "nil")
    }
  }
  deinit { print("ViewModel deinit") }
}

var vm: ViewModel? = ViewModel()
vm?.setup()
vm = nil   // deinit 正常调用
```

* 选择：`self` 可能变 `nil` → `[weak self]`；确定闭包执行时 `self` 仍存活 → `[unowned self]`（否则崩溃）。
* 若闭包只捕获局部变量、不捕获 `self`，则无环，正常释放。

### 场景三：委托模式（Delegate）

* 委托属性若为强引用，且委托方与代理方互相强持有 → 保留环。

```swift
protocol DownloaderDelegate: AnyObject { func downloadDidFinish() }

class Downloader {
  weak var delegate: DownloaderDelegate?   // 弱引用打破环
  deinit { print("Downloader deinit") }
}
```

> 注：弱引用委托须将协议限定为 `AnyObject`（仅类可遵循），否则无法用 `weak`。

## Copy-on-Write（CoW / 写时复制）

* 适用类型：`Array`、`Set`、`Dictionary`、`Data`、`String`。它们均为值类型，但**底层存储（backing storage）在堆**，值本身仅持有指向它的指针（见布局篇）。
* 行为：赋值时**不立即拷贝**，多个值共享同一底层缓冲区；**仅当某一方发生 mutation 时**才真正复制，以保留值语义。
* 唯一性判断：mutation 前调用 `isKnownUniquelyReferenced` 检查缓冲区是否为唯一强引用；唯一 → 原地修改，共享 → 复制后修改。
* 收益：在未修改前避免昂贵的堆内存复制，兼顾值语义与性能。

```swift
var array1 = [1, 2, 3]
var array2 = array1          // 共享同一缓冲区，无拷贝
array2.append(4)             // 检测到共享 → 复制后再修改

final class Buffer {
  var storage: [Int]
  init(_ s: [Int]) { self.storage = s }
}
var b1 = Buffer([1, 2, 3])
var b2 = b1
isKnownUniquelyReferenced(&b1)   // false：b1 与 b2 共享
b2 = Buffer(b2.storage)          // 模拟 CoW：b2 指向新实例
isKnownUniquelyReferenced(&b1)   // true：b1 现唯一
```

> 注：自定义 `struct` 默认**不**具备 CoW，属性会被立即逐字段拷贝；大结构体如需 CoW，需自行用 `isKnownUniquelyReferenced` 实现（标准库集合即此机制）。

## 优化建议（Optimization）

* **非必要不用 `class`**：优先 `struct` / `enum`。值语义无 ARC 开销、默认在栈，更安全高效。
* **打破强引用**：闭包用 `[weak self]` / `[unowned self]`，委托用 `weak var delegate`。
* **保持类的小巧**：类越大、耦合越紧，ARC 负担越重，也越难测试。
* **用值类型作字典键**：如 `struct AvatarConfiguration: Hashable`，类型安全且避免堆间接寻址（heap indirection）。
* **用强类型替代裸字符串**：
  * 标识符用 `UUID` 替 `String`（128 位、紧凑、类型安全）。
  * 文件类型用 `enum DocType: String` 替字符串字面量（易重构、难误用）。

```swift
struct AvatarConfiguration: Hashable {
  var style: AvatarStyle
  var mood: Mood
  var accessory: Accessory
}
var avatarCache = [AvatarConfiguration: UIImage]()   // 类型安全，无堆间接寻址

struct Document {
  let path: URL
  let identifier: UUID
  let fileType: DocType
}
```

## 调试工具（Debugging）

* **Instruments（Allocations & Leaks）**：追踪内存分配、检测泄漏，性能分析首选。
* **Memory Graph Debugger（内存图调试器）**：可视化展示对象引用关系与保留环，一目了然地查看活动实例与持有链。

> 注：开发期即检查，优于上线后救火。
