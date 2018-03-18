# simpleParser一个简单ES5的js语法分析器

### 介绍
* 语法规范是使用[estree](https://github.com/estree/estree)的ES5语法规范
* 解析器只能单纯的将字符串代码解析成语法树，不支持其他功能
* 参考了[acornjs](https://github.com/acornjs/acorn)部分代码

### 特点
* 为了解决在分词时'/'是判为操作符还是正则表达式的问题，我采用边分词边解析的方式解决。在读取一个表达式后，然后让tokenizer在遇到'/'是优先读取操作符，奇遇的情况都认为是正则表达式。这样既简单，又能保证没有错误。
* 支持一些简单的语法检查。例如：赋值左边类型检查，自更新操作符类型检查，break与continue的label检查等
* 在读取含有多个操作符的表达式时，我利用操作符的优先级采用贪心读取的方式，这样可以使用一个简单的递归就可以处理Expression的读取问题。 
例如：
```javascript
// 表达式
 a + b * c.d - e
// 优先级
{
'+': 13
'*': 14
'.': 19
'-': 13
}
// 读取的过程以及每一步的状态。括号内的部分就是一个Expression
// a  ->  b  ->  c  ->  d  ->  e
   a  +   b
   a  +  (b  *   c)
   a  +  (b  *  (c   .  d))
  (a  +  (b  *  (c   .  d))) - e

```

### 使用
浏览器引入与使用
```javascript
<script src="path/to/simpleParser.js"></script>
// 使用
// 在全局变量`window`下会有一个simpleParser变量
var code = '1+1==2';
var programs = simpleParser.parse(code);
```
node引入与使用
```javascript
const simpleParser = require('path/to/simpleParser.js')
// 使用
let code = '1+1==2';
let programs = simpleParser.parse(code);
```
