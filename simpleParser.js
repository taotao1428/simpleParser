(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
	typeof define === 'function' && define.amd ? define(['exports'], factory) :
	(factory((global.simpleParser = {})));
}(this, (function (exports) { 'use strict';

function Parser(input){
	this.input = input;
	this.pos = 0;
	this.labels = [];
}

/* parse部分 */

var LiteralRegx = /^(string|num|null|undefined|regx|true|false)$/;

var loopLabel = {kind: "loop"};
var switchLabel = {kind: "switch"};

/* 用于获取操作符的优先级 */
function getPriority(opr, prefix){
	switch(opr){
		case '(': return 20;
		case '.': case 'new': case '[': return 19;
		case '++': case '--': return prefix ? 16 : 17;
		case '+': case '-': return prefix ? 16 : 13;
		case '!': case '~': case 'typeof': case 'void': case 'delete': return 16;
		case '**': return 15;
		case '*': case '/': case '%': return 14; 
		case '<<': case '>>': case '>>>': return 12;
		case '<': case '<=': case '>': case '>=': case 'in': case 'instanceof': return 11;
		case '==': case '!=': case '===': case '!==': return 10;
		case '&': return 9;
		case '^': return 8;
		case '|': return 7;
		case '&&': return 6;
		case '||': return 5;
		case '?': return 4;
		case '=': case '+=': case '-=': case '*=': case '/=': case '%=': case '<<=': 
			case '>>=': case '>>>=': case '&=': case '^=': case '|=': return 3;
		default: 
			console.log(opr, prefix);
			throw new Error('不存在的操作符')
	}
}

/* 源字符的位置 */
function SourceLocation(input, start, startLoc, end, endLoc){
	this.source = input.substring(start, end);
	this.start = startLoc;
	this.end = endLoc;
}

/* 节点类 */
function Node(){
	this.type = '';
	this.loc = null;
}

var parser = Parser.prototype;

parser.parse = function(){
	var node = this.startNode();
	node.body = [];
	this.next();
	while(!this.is(types.eof)){
		node.body.push(this.parseStatement());
	}
	return this.finishNode(node, 'Programs');
}

/* 创建一个节点，保存初始位置 */
parser.startNode = function(){
	var node = new Node();
	//将开始的信息保存
	node.start = this.start;
	node.startLoc = this.startLoc;

	return node;
}

parser.startNodeAt = function (start, startLoc){
	var node = new Node();
	//将开始的信息保存
	node.start = start;
	node.startLoc = startLoc;

	return node;
}

/* 补全节点的信息 */
parser.finishNode = function(node, type){
	node.type = type;
	node.loc = new SourceLocation(this.input, node.start, node.startLoc, this.lastTokEnd, this.lastTokEndLoc);
	// 删除储存在节点的开始信息
	delete node.start;
	delete node.startLoc;
	return node;
}

parser.parseStatement = function(){
	var node = this.startNode();
	switch(this.type){
		case types.keyword: 
			switch(this.value){
				case 'if': return this.parseIfStatement(node);
				case 'debugger': return this.parseDebuggerStatement(node);
				case 'with': return this.parseWithStatement(node);
				case 'return': case 'throw': return this.parseReturnThrowStatement(node, this.value); 
				case 'break': case 'continue': return this.parseBreakContinueStatement(node, this.value);
				case 'switch': return this.parseSwitchStatement(node);
				case 'try': return this.parseTryStatement(node);
				case 'while': return this.parseWhileStatement(node);
				case 'do': return this.parseDoStatement(node);
				case 'var': return this.parseVarStatemnt(node);
				case 'for': return this.parseForStatement(node);
				case 'function': return this.parseFunctionStatement(node);
				default: this.raise(this.start, 'Unknow keyword: {0}', this.value);
			};
		case types.semi: this.next(); return this.finishNode(node, 'EmptyStatement');
		case types.braceL: return this.parseMaybeBlockStatement(node);
		default: return this.parseMaybeExpressionStatement(node);
	}
}

/* 读取if语句 */
parser.parseIfStatement = function(node){
	this.next();
	node.test = this.readExpressionInParen();
	node.consequent = this.parseStatement();
	node.alternate = null;
	if(this.type === types.keyword && this.value === 'else'){
		this.next();
		node.alternate = this.parseStatement();
	}
	return this.finishNode(node, 'IfStatement');
}

/* 读取debugger语句 */ 
parser.parseDebuggerStatement = function(node){
	this.next();
	this.checkEnd();
	return this.finishNode(node, 'DebuggerStatement');
}

/* 读取with语句 */
parser.parseWithStatement = function(node){
	this.next();
	node.object = this.readExpressionInParen();
	node.body = this.parseStatement();
	return this.finishNode(node, 'WithStatement');
}

/* 读取return和throw语句 */
parser.parseReturnThrowStatement = function(node, keyword){
	this.next();
	node.argument = null;
	if(!this.isEnd()){
		node.argument = this.readMaybeSequenceExpression();
		this.checkEnd();
	}else if(keyword === 'throw'){ // throw语句必须有参数
		this.raise(this.start, 'throw statement need argument');
	}
	return this.finishNode(node, keyword == 'throw' ? 'ThrowStatement': 'ReturnStatement');
}

/* 读取break与continue语句 */
parser.parseBreakContinueStatement = function(node, keyword){
	var isBreak = keyword === 'break';
	this.next();
	node.label = null;
	if(!this.isEnd()){
		if(this.type !== types.name){ this.raise(this.start, 'Unexpected token: {0}({1})', this.type.label, this.value); }
		node.label = this.readIdentifier();
		this.checkEnd();
	}
	
	var i = 0;
  for (; i < this.labels.length; ++i) {
    var lab = this.labels[i];
    if (node.label == null || lab.name === node.label.name) {
      if (lab.kind != null && (isBreak || lab.kind === "loop")) { break }
      if (node.label && isBreak) { break }
    }
  }
  if (i === this.labels.length) { this.raise(node.start, 'Unexpected {0} or can\'t find valid label', keyword); }
	return this.finishNode(node, isBreak ? 'BreakStatement' : 'ContinueStatement');
}

/* 读取switch语句 */
parser.parseSwitchStatement = function(node){
	this.next();
	node.Discriminant = this.readExpressionInParen();
	node.cases = [];
	var hasDefault = false;
	this.eat(types.braceL);
	this.labels.push(switchLabel);
	while(this.type !== types.braceR){
		var caseStatement = this.parseCaseStatement();
		if(caseStatement.test === null){
			if(hasDefault){
				this.raise(this.start, 'More than one default clause in switch statement')
			}
			hasDefault = true;
		}
		node.cases.push(caseStatement);
	}
	this.labels.pop();
	this.next();
	return this.finishNode(node, 'SwitchStatement');
}
parser.parseCaseStatement = function(){
	var node = this.startNode();
	if(this.type == types.keyword){
		if(this.value === 'case'){
			this.next();
			node.test = this.readMaybeSequenceExpression();
		}else if(this.value === 'default'){
			node.test = null;
			this.next();
		}else{
			this.raise(this.start, 'Unexpected token: {0}({1})', this.type.label, this.value);
		}
	}else{
		this.raise(this.start, 'Unexpected token: {0}({1})', this.type.label, this.value);
	}
	this.eat(types.colon);
	node.consequent = [];
	while(!this.is(types.braceR) && !this.is(types.keyword, 'case') && !this.is(types.keyword, 'default')){
		node.consequent.push(this.parseStatement());
	}
	return this.finishNode(node, 'SwitchCase');
}

/* 读取try语句 */
parser.parseTryStatement = function (node){
	this.next();
	this.expect(types.braceL);
	node.block = this.parseStatement();
	node.handler = null;
	if(this.is(types.keyword, 'catch')){
		node.handler = this.parserCatchClause();
	}
	if(node.handler === null){
		this.expect(types.keyword, 'finally');
	}
	node.finalizer = null;
	if(this.is(types.keyword, 'finally')){
		this.next();
		this.expect(types.braceL);
		node.finalizer = this.parseStatement();
	}
	return this.finishNode(node, 'TryStatement');
}
/* 读取catch语句 */ 
parser.parserCatchClause = function(){
	var node = this.startNode();
	this.next();
	this.eat(types.parenL);
	this.expect(types.name);
	node.param = this.readIdentifier();
	this.eat(types.parenR);
	this.expect(types.braceL);
	node.body = this.parseStatement();
	return this.finishNode(node, 'CatchClause');
}

/* 读取while语句 */
parser.parseWhileStatement = function(node){
	this.next();
	node.test = this.readExpressionInParen();
	this.labels.push(loopLabel);
	node.body = this.parseStatement();
	this.labels.pop();
	return this.finishNode(node, 'WhileStatement');
}

/* 读取dowhile语句 */
parser.parseDoStatement = function(node){
	this.next();
	this.labels.push(loopLabel);
	node.body = this.parseStatement(0);
	this.labels.pop();
	this.eat(types.keyword, 'while');
	this.expect(types.parenL);
	node.test = this.readExpressionInParen();
	return this.finishNode(node, 'DoWhileStatement');
}

/* 解析var变量定义语句 */
parser.parseVarStatemnt = function(node, inFor){
	this.next();
	node.kind = 'var';
	var declarations = [];
	declarations.push(this.parseDeclarator(inFor));
	while(this.is(types.comma)){
		this.next();
		declarations.push(this.parseDeclarator(inFor));
	}
	// 在for与for-in 循环中不需要检查
	!inFor && this.checkEnd();
	node.declarations = declarations;
	return this.finishNode(node, 'VariableDeclaration');
}
parser.parseDeclarator = function(inFor){
	var node = this.startNode();
	this.expect(types.name);
	node.id = this.readIdentifier();
	node.init = null;
	if(this.is(types.operator, '=')){
		this.next();
		node.init = this.readExpression(0, {inFor: inFor});
	}
	return this.finishNode(node, 'VariableDeclarator');
}

/* 解析for与for-in语句 */
parser.parseForStatement = function(node){
	this.next();
	this.eat(types.parenL);
	if(this.is(types.keyword, 'var')){
		var variableDeclaration = this.parseVarStatemnt(this.startNode(), true),
				declarations = variableDeclaration.declarations;
		if(this.is(types.semi)){
			return this.parseFor(variableDeclaration, node);
		}else if(this.is(types.operator, 'in')){
			return this.parseForIn(variableDeclaration, node);
		}else{
			this.raise(this.start, 'Unexpected token: {0}({1})', this.type.lable, this.value);
		}
	}
	if(this.is(types.semi)){
		return this.parseFor(null, node);
	}
	var exression = this.readMaybeSequenceExpression(true);
	if(exression.type == 'Identifier' && this.is(types.operator, 'in')){ 
		return this.parseForIn(exression, node);
	}else{
		return this.parseFor(exression, node);
	}
}

parser.parseFor = function(init, node){
	this.eat(types.semi);
	node.init = init;
	node.test = null;
	if(!this.is(types.semi)){
		node.test = this.readMaybeSequenceExpression();
	}
	this.eat(types.semi);
	node.update = null;
	if(!this.is(types.parenR)){
		node.update = this.readMaybeSequenceExpression();
	}
	this.eat(types.parenR);
	this.labels.push(loopLabel);
	node.body = this.parseStatement();
	this.labels.pop();
	return this.finishNode(node, 'ForStatement');
}

parser.parseForIn = function(left, node){
	if(left.type == 'VariableDeclaration'){
		var declarations = left.declarations;
		if(declarations.length > 1){ this.raise(node.start, 'Invalid left-hand side in for-in loop: Must have a single binding'); }
	};
	node.left = left;
	this.eat(types.operator, 'in');
	node.right = this.readMaybeSequenceExpression();
	this.eat(types.parenR);
	this.labels.push(loopLabel);
	node.body = this.parseStatement();
	this.labels.pop();

	return this.finishNode(node, 'ForInStatement');
}

parser.parseFunctionStatement = function(node){
	this.next();
	this.expect(types.name);
	node.id = this.readIdentifier();
	node.params = this.readFunctionParams();
	this.expect(types.braceL);
	node.body = this.parseStatement();
	return this.finishNode(node, 'FunctionDeclaration');
}


parser.parseMaybeBlockStatement = function(node){
	this.next();
	node.body = [];
	while(!this.is(types.braceR)){
		node.body.push(this.parseStatement());
	}
	this.next();
	return this.finishNode(node, 'BlockStatement');
}

parser.parseMaybeExpressionStatement = function(node){
	var exression = this.readMaybeSequenceExpression();
	// 如果第一是变量，可能是lable
	if(exression.type === 'Identifier' && this.is(types.colon)){
		this.next();
		return this.parseLabeledStatement(node, exression);
	}
	node.exression = exression;
	this.checkEnd();
	return this.finishNode(node, 'ExpressionStatement');
}

parser.parseLabeledStatement = function(node, expr){
	var maybeName = expr.name;
  for (var i = 0, list = this.labels; i < list.length; i += 1){
    var label = list[i];

    if (label.name === maybeName){ this.raise(node.start, "Label '" + maybeName + "' is already declared");} 
  }
  var kind = this.is(types.keyword, 'for') 
  				|| this.is(types.keyword, 'while') 
  				|| this.is(types.keyword, 'do') ? "loop" : this.is(types.keyword, 'switch') ? "switch" : null;
  for (var i = this.labels.length - 1; i >= 0; i--) {
    var label = this.labels[i];
    if (label.statementStart == node.start) {
      // Update information about previous labels on this node
      label.statementStart = this.start;
      label.kind = kind;
    } else { break }
  }
  this.labels.push({name: maybeName, kind: kind, statementStart: this.start});
  node.body = this.parseStatement(true);
  this.labels.pop();
  node.label = expr;
  return this.finishNode(node, "LabeledStatement")
}

/* 检查一条语句是否结束 */
parser.checkEnd = function(){
	this.isEnd() || this.raise(this.start, 'Unexpected token : {0}({1})', this.type.label, this.value);
}
/* 判断一条语句是否结束 */
parser.isEnd = function(){
	if(this.is(types.eof)||this.is(types.braceR)){
		return true;
	}
	// 如果是是';'说明语句结束；
	if(this.type === types.semi){
		this.next();
		return true;
	}
	// 如果两个token有换行，也说明语句结束
	var space = this.input.slice(this.lastTokEnd, this.start);
	return lineBreakRegx.test(space);
}

parser.referenceErr = function(loc, msg){
	var args = slice.call(arguments, 2),
			regx = /\{(\d+)\}/g;

	msg = msg.replace(regx, function(match, num){
		return args[parseInt(num)];
	})
	msg += ' ('+ loc.line +':'+ loc.column + ')';

	var err = new ReferenceError(msg);
	throw err;
}

parser.readExpression = function (priority, opitions){ // 如果是从右到左的操作符equal为true
	opitions = opitions || {};
  var start = this.start, startLoc = this.startLoc, node;
  // console.log(this.type, this.value);
  if(this.type.isOpr){
  	if(this.type === types.parenL){
  		// 为了凸显括号的作用，被括号包围的表达式都以sequenceExpression返回
  		node = this.readSequenceExpressionInParen();
  	}else if(this.type === types.bracketL){
  		node = this.readArrayExpression();
  	}else if(this.is(types.operator, 'new')){
  		node = this.readNewExpression();
  	}else{
  		node = this.readUnaryExpression();
  	}
  }else if(LiteralRegx.test(this.type.label)){
    node = this.readLiteral();
    // console.log(this.type, this.value)
  }else if(this.type === types.name){
    node = this.readIdentifier();
  }else if(this.type === types.this){
  	node = this.readThisExpression();
  }else if(this.type === types.keyword && this.value === 'function'){
    node = this.readFunctionExpression();
  }else if(this.type === types.braceL){
    node = this.readObjectExpression();
  }else{
    this.raise(this.start, 'Unexpected token : {0}', this.type.label);
  }
  var newPriority;
  while(this.type.isOpr && (newPriority = getPriority(this.value)) > priority){
  	// 如果是在for语句中，前一部分中不能直接包含in
  	if(opitions.inFor && this.value == 'in'){
  		break;
  	}
  	var oldNode = node;
  	node = this.startNodeAt(start, startLoc);
    // 开始对操作符分类讨论
    if(/^(==|!=|===|!==|<|<=|>|>=|<<|>>|>>>|\+|-|\*|\/|%|\||\^|&|in|instanceof)$/.test(this.value)){
      // 二元操作符
      node.operator = this.value;
      node.left = oldNode;
      this.next();
      node.right = this.readExpression(newPriority, opitions);
      this.finishNode(node, 'binaryExpression');
    }else if(/^(=|\+=|-=|\*=|\/=|%=|<<=|>>=|>>>=|\|=|\^=|&=)$/.test(this.value)){
      // 赋值语句
      node.operator = this.value;
      node.left = oldNode;
      this.checkVal(oldNode, true);
      this.next();
      node.right = this.readExpression(newPriority-1, opitions);
      this.finishNode(node, 'AssignmentExpression');
    }else if(/^(\|\||&&)$/.test(this.value)){
      node.operator = this.value;
      node.left = oldNode;
      this.next();
      node.right = this.readExpression(newPriority, opitions);
      this.finishNode(node, 'LogicalExpression');
    }else if(/^(\.|\[)$/.test(this.value)){
      node.object = oldNode; 
      if(this.value === '.'){
      	this.next();
        node.property = this.readExpression(newPriority, opitions);
        node.computed = true;
      }else{
        node.property = this.readExpressionInBracket(); // 获得[]里面的内容
        node.computed = false;
      }
      this.finishNode(node, 'MemberExpression');
    }else if(this.value === '?'){
      // 三元表达式
      node.test = oldNode;
      this.next();
      node.consequent = this.readExpression(0, opitions);
      this.expect(types.colon);
      this.next();
      node.alternate = this.readExpression(0, opitions);
      this.finishNode(node, 'ConditionalExpression');
    }else if(this.type === types.parenL){
    	node.callee = oldNode;
    	node.arguments = this.readCallArgs();
    	this.finishNode(node, 'CallExpression');
    }else if(/^(\+\+|--)$/.test(this.value)){
    	node.operator = this.value;
    	node.arguments = oldNode;
    	this.checkVal(oldNode);
    	node.prefix = false;
    	this.next();
    	this.finishNode(node, 'UpdateExpression');
    }else{
    	this.raise(this.start, 'Unknow operator: {0}', this.value)
    }
  }
  return node;
}


parser.readNewExpression = function(){
	var node = this.startNode();
	this.next();
	var expression = this.readExpression(getPriority('new', true)-1);
	if(expression.type == 'CallExpression'){
		node.callee = expression.callee;
		node.arguments =expression.arguments
	}else{
		node.callee = expression;
		node.arguments = [];
	}
	
	return this.finishNode(node, 'NewExpression');
}

parser.readMaybeSequenceExpression = function(inFor){
	var node = this.startNode(),
			expressions = [];
	expressions.push(this.readExpression(0, {inFor: inFor}))
	while(this.type === types.comma){
		this.next();
		expressions.push(this.readExpression(0, {inFor: inFor}));
	}
	if(expressions.length === 1){
		return expressions[0];
	}
	node.expressions = expressions;
	return this.finishNode(node, 'SequenceExpression');
}

parser.readSequenceExpressionInParen = function(){
	var node = this.startNode();
	this.eat(types.parenL);
	var expressions = [];
	expressions.push(this.readExpression(0))
	while(this.type === types.comma){
		this.next();
		expressions.push(this.readExpression(0));
	}
	this.expect(types.parenR);
	this.next(true);
	node.expressions = expressions;
	return this.finishNode(node, 'SequenceExpression');
}

// 读取()中的表达式，需确保里面有内容，否者报错
parser.readExpressionInParen = function (){
	this.expect(types.parenL);
	this.next();
	var expression = this.readMaybeSequenceExpression();
	this.expect(types.parenR);
	this.next(true);
	return expression;
}

/* 读取a['b']中[]内的表达式 */
parser.readExpressionInBracket = function(){
	this.expect(types.bracketL);
	this.next();
	var expression = this.readMaybeSequenceExpression();
	this.expect(types.bracketR);
	this.next(true);
	return expression;
}

parser.readArrayExpression = function (){
	this.expect(types.bracketL);
	var node = this.startNode();
	this.next();
	node.elements = [];
	if(this.type !== types.bracketR){
		node.elements.push(this.readExpression(0));
		while(this.is(types.comma)){
			this.next();
			node.elements.push(this.readExpression(0));
		}
	}
	this.expect(types.bracketR);
	this.next(true);
	return this.finishNode(node, 'ArrayExpression');
}

parser.readUnaryExpression = function (){
	var node = this.startNode(), operator = this.value;
	// 检查是否可以为前置操作符
	if(!/^(!|~|\+|-|\+\+|--|typeof|void|delete)$/.test(operator)){
		this.raise(this.start, 'Unexpected operator: {0}', operator);
	}
	var isUpdate = /^(\+\+|--)$/.test(operator),
			type = isUpdate ? 'UpdateExpression' : 'UnaryExpression';
	node.operator = operator;
	this.next();
	node.arguments = this.readExpression(getPriority(operator, true));
	if(isUpdate){
		this.checkVal(node.arguments);
	}
	node.prefix = true;
	return this.finishNode(node, type);
}

parser.readLiteral = function (){
	var node = this.startNode();
	if(this.type === types.regx){
		node.regex = this.value;
		node.value = new RegExp(this.value.pattern.slice(1, -1), this.value.flags); 
	}else{
		node.value = this.value;
	}
	this.next(true);
	return this.finishNode(node, 'Literal');
}

parser.readIdentifier = function(){
	var node = this.startNode();
	node.name = this.value;
	this.next(true);
	return this.finishNode(node, 'Identifier');
}

parser.readThisExpression = function(){
	var node = this.startNode();
	this.next(true);
	return this.finishNode(node, 'ThisExpression');
}

parser.readFunctionExpression = function(){
	var node = this.startNode();
	this.next();
	if(this.type === types.name){
		node.id = this.readIdentifier();
	};
	node.params = this.readFunctionParams();
	this.expect(types.braceL);
	node.body = this.parseStatement();
	return this.finishNode(node, 'FunctionExpression');
}

parser.readFunctionParams = function(){
	var params = [];
	this.expect(types.parenL);
	this.next();
	if(this.type !== types.parenR){
		this.expect(types.name);
		params.push(this.readIdentifier());
		while(this.type == types.comma){
			this.next();
			this.expect(types.name);
			params.push(this.readIdentifier());
		}
	}
	this.expect(types.parenR);
	this.next(true);
	return params;
}

parser.readObjectExpression = function(){
	var node = this.startNode();
	node.properties = [];
	this.next();
	if(this.type !== types.braceR){
		node.properties.push(this.readProperty());
		while(this.type === types.comma){
			this.next();
			node.properties.push(this.readProperty());
		}
	}
	this.expect(types.braceR);
	this.next(true);
	return this.finishNode(node, 'ObjectExpression');
}

parser.readProperty = function(){
	var node = this.startNode();
	// 检查key的类型
	if(LiteralRegx.test(this.type.label)){
		node.key = this.readLiteral();
	}else if(this.type === types.name){
		node.key = this.readIdentifier();
	}else{
		this.raise(this.start, 'Unexpected token: {0}({1})', this.type.label, this.value);
	}
	this.expect(types.colon);
	this.next();
	node.value = this.readExpression(0);
	node.kind = 'init';
	return this.finishNode(node, 'Property');
}

parser.readCallArgs = function(){
	var nodes = [];
	this.next();
	if(this.type !== types.parenR){
		nodes.push(this.readExpression(0));
		while(this.type === types.comma){
			this.next();
			nodes.push(this.readExpression(0));
		}
	}
	this.expect(types.parenR);
	this.next(true);
	return nodes;
}

parser.checkVal = function(expression, assign){
	switch(expression.type){
		case 'MemberExpression': case 'Identifier': return true;
		case 'SequenceExpression': 
			var expressions = expression.expressions;
			if(expressions.length == 1) return this.checkVal(expressions[0], assign);
		default:
			var msg = assign ?  'Invalid left-hand side expression in assignment' : 'Invalid expression in update operation';
			this.referenceErr(expression.loc.start, msg)
	}
}

parser.expect = function(type, value){
	if(this.type !== type || (value && this.value !== value)){
		this.raise(this.start, 'Unexpected token: {0}({1})', this.type.label, this.value);
	}
}

parser.is = function(type, value){
	return this.type === type && (!value || this.value === value);
}

parser.eat = function(type, value){
	this.expect(type, value);
	this.next();
}

// 转化为一个没有原型的对象，方便for-in与in的使用
function map(obj){
	var map = Object.create(null);
	for(var k in obj){
		if(obj.hasOwnProperty(k)){
			map[k] = obj[k];
		}
	}
	return map;
}

/* tokenizer部分 */

// token的类型
function TokenType(label, conf) {
  if ( conf === void 0 ) conf = {};
  this.label = label;
  this.isOpr = !!conf.isOpr;
};
var types = {
  num: new TokenType("num"),
  regx: new TokenType("regx"),
  string: new TokenType("string"),
  name: new TokenType("name"),
  eof: new TokenType("eof"),

  // 普通字符
  bracketL: new TokenType("[", {isOpr: true}),
  bracketR: new TokenType("]"),
  braceL: new TokenType("{"),
  braceR: new TokenType("}"),
  parenL: new TokenType("(", {isOpr: true}),
  parenR: new TokenType(")"),
  comma: new TokenType(","),
  semi: new TokenType(";"),
  colon: new TokenType(":"),


  // 操作符与关键字操作符
  operator: new TokenType('operator', {isOpr: true}),
  dot: new TokenType(".", {isOpr: true}),
  question: new TokenType("?", {isOpr: true}),

  // 特殊的数据类型
  this: new TokenType("this"),
  null: new TokenType("null"),
  undefined: new TokenType("undefined"),
  true: new TokenType('true'),
  false: new TokenType('false'),

  // 关键字类型
  keyword: new TokenType('keyword')
};

// 用于判断类型的几个正则表达式
var numRegx = /\d/,
		identStartRegx = /[$_a-zA-Z]/,
		identRegx = /[$_a-zA-Z0-9]/,
		lineBreakRegx = /\r\n?|\n|\u2028|\u2029/,
		lineBreakGRegx = new RegExp(lineBreakRegx.source, 'g'),
		kwOprRegx = /^(in(stanceof)?|typeof|void|delete|new)$/,
		kwRegx = /^(break|case|catch|continue|debugger|default|do|else|finally|for|function|if|return|switch|throw|try|var|while|with)$/;

var specialVar = map({'true': true, 'false': false, 'null': null, 'undefined': undefined});
var ESCAPE = {'n': '\n', 'f': '\f', 'r': '\r', 't': '\t', 'v': '\v'};

var slice = Array.prototype.slice;

/* 将tokenizer加到Parse原型上 */
var tokenizer = Parser.prototype;

/* 读取下一个token */
tokenizer.next = function(needOpr){
	// 直接跳过注释
	this.skipSpace();
	this.lastTokEnd = this.end;
	this.lastTokEndLoc = this.endLoc;
	this.start = this.pos;
	this.startLoc = this.curPosition();
	if(this.pos >= this.input.length){
		return this.finishToken(types.eof);
	}
	return this.read(needOpr);
}


/* 读取一个token */
tokenizer.read = function(needOpr){
	var ch = this.input.charAt(this.pos);
	// 如果是表示符，先读取
	if(identStartRegx.test(ch)){
		return this.readWord(ch);
	}

	switch(ch){
		// 单独存在且简单的符号
	  case '(': ++this.pos; return this.finishToken(types.parenL, '(')
	  case ')': ++this.pos; return this.finishToken(types.parenR, ')')
	  case ';': ++this.pos; return this.finishToken(types.semi, ';')
	  case ',': ++this.pos; return this.finishToken(types.comma, ',')
	  case '[': ++this.pos; return this.finishToken(types.bracketL, '[')
	  case ']': ++this.pos; return this.finishToken(types.bracketR, ']')
	  case '{': ++this.pos; return this.finishToken(types.braceL, '{')
	  case '}': ++this.pos; return this.finishToken(types.braceR, '}')
	  case ':': ++this.pos; return this.finishToken(types.colon, ':')

	  // 读取字符串
	  case '"': case '\'': return this.readString(ch)

	  // 读取数字
	  case '0':
	  	var next = this.input.charAt(this.pos + 1);
	    return next === 'x' || next === 'X' ? this.readHexNumber() : this.readOctNumber(); // 十六进制与八进制
	  case '1': case '2': case '3': case '4': case '5': case '6': case '7': case '8': case '9':
			return this.readNumber();

		// 可能是小数，或者成员连接符
	  case '.': return this.readDot()
		// 读取除号或者正则表达式
		case '/': return this.readSlash(needOpr)
		// 读取一般的操作符 +-*/%=!<>?&|~^
		case '+': case '-': case '*': case '?': case '%': case '=': case '!': case '<': case '>': case '&': case '|': case '~': case '^':
			return this.readOperator();
		default: 
			this.raise(this.pos, 'Unexpected character : {0}', ch);
	}
}

/* 跳过空白与注释 */
tokenizer.skipSpace = function (){
	skip:
	do{
		var ch = this.input.charAt(this.pos);
		// 如果是不可见字符，直接跳过
		if(/\s/.test(ch)){ continue; } 
		// 检查是否为注释
		if(ch === '/'){
			var nextCh = this.input.charAt(this.pos + 1);
			switch(nextCh){
				case '/': this.skipLineComment(); break;
				case '*': this.skipBlockComment(); break;
				default: break skip;
			}
		}else{
			break;
		}

	}while(++this.pos < this.input.length);
}

/* 跳过单行注释 */
tokenizer.skipLineComment = function(){
	this.pos ++; //指向第二个'/'
	while(++this.pos < this.input.length){
		var ch = this.input.charAt(this.pos);
		if(lineBreakRegx.test(ch)){
			break;
		}
	}
}

/* 跳过多行注释 */
tokenizer.skipBlockComment = function(){
	this.pos += 2;
	while(true){
		if(++this.pos >= this.input.length) { this.raise(this.start, 'block comment missing "*/"'); }
		var ch = this.input.charAt(this.pos);
		if(ch === '*' && this.input.charAt(this.pos + 1) === '/'){
			this.pos++;
			break;
		}
	}
}

/* 读取右斜杠 */
tokenizer.readSlash = function(needOpr){
	// 如果现在需要一个操作符，就将/作为操作符的开头
	return needOpr === true ? this.readOperator() : this.readRegx();
}

/* 读取操作符 */
tokenizer.readOperator = function(){
	var operator,
			ch = this.input.charAt(this.pos),
			ch2 = ch + this.input.charAt(this.pos + 1),
			ch3 = ch2 + this.input.charAt(this.pos + 2),
			regx = /^(\+(\+|=)?|-(-|=)?|[*/%]=?|[=!]={0,2}|>(=|>)?|<(=|<)?|\?|(\||&){1,2}|~|\^)$/;

	operator = regx.test(ch3) ? ch3 : (regx.test(ch2) ? ch2 : ch);
	this.pos += operator.length;

	return this.finishToken(types.operator, operator);
}

/* 读取正则表达式。仅仅读取不判断正确性 */
tokenizer.readRegx = function(){ 
  var stack = [], escape = false, value = '/', flags = '';

  // 读取正则表达式value
  while(true){
  	var nextChar = this.input.charAt(++this.pos);
  	// 如果在输入结束或者换行时还是没有找到边界'/'，就报错
  	if(this.pos >= this.input.length || lineBreakRegx.test(nextChar)) {
  		this.raise(this.start, 'Invalid regular expression : miss /');
  	}

  	value += nextChar;
    if(escape){
      escape = false;
    }else if(nextChar === '\\'){
      escape = true;
    }else if(nextChar === '/' && stack.indexOf('[') === -1){ // 方括号里面允许/存在
    	this.pos++;
    	break;
    }else{
      let context = stack[stack.length-1];
      if(nextChar === '('){
        if(context!=='['){
          stack.push('(')
        }
      }else if(nextChar === ')'){
        if(context == '('){
          stack.pop();
        }
      }else if(nextChar === '['){
        if(context !== '['){
          stack.push('[')
        }
      }else if(nextChar == ']'){
        if(context == '['){
          stack.pop();
        }
      }
    }
  }

  // 读取flags
  do{
  	var ch = this.input.charAt(this.pos);
  	if(/i|g|m/.test(ch)){
  		// 如果出现之前出现的flag就报错
  		if(flags.indexOf(ch) !== -1){
  			this.raise(this.start, 'Invalid regular expression flags');
  		}
  		flags += ch;
  	}else if(identStartRegx.test(ch)){// 如果出现属于标识符的字符出现就报错
  		this.raise(this.start, 'Invalid regular expression flags')
  	}else{
  		break;
  	}
  } while(++this.pos < this.input.length);

  return this.finishToken(types.regx, {pattern: value, flags: flags});
}

/* 读取点 */
tokenizer.readDot = function(){
	var ch = this.input.charAt(this.pos+1);
	// 如果点后面接的是一个数字，该点为小数点
	if(numRegx.test(ch)){
		return this.readNumber();
	}
	this.pos++;
	return this.finishToken(types.operator, '.');
}

/* 读取16进制的数字 */
tokenizer.readHexNumber = function(){
	this.pos++;
	var num = '';
	while(++this.pos < this.input.length){
		var ch = this.input.charAt(this.pos);
		if(/[0-9a-fA-F]/.test(ch)){
			num += ch;
		}else if(identStartRegx.test(ch)){
			this.raise(this.start, 'Invalid or unexpected token')
		}else{
			break;
		}
	}

	return this.finishToken(types.num, parseInt(num, 16));
}
/* 读取8进制的数字 */
tokenizer.readOctNumber = function(){
	var num = '';
	while(++this.pos < this.input.length){
		var ch = this.input.charAt(this.pos);
		if(/[0-9]/.test(ch)){
			num += ch;
		}else if(identStartRegx.test(ch)){
			this.raise(this.start, 'Invalid or unexpected token')
		}else{
			break;
		}
	}
	// 如果存在8或者9，依然将其当做10进制处理
	var system = /8|9/.test(num) ? 10 : 8;
	return this.finishToken(types.num, parseInt(num, system));
}
/* 读取10进制的数字 */
tokenizer.readNumber = function(hasPoint){
	hasPoint = !!hasPoint;
	var num = '', hasPoint = false, hasExp = false, expEnd=true, numRegx = /[0-9]/;

	do{
		var ch = this.input.charAt(this.pos);
		if(numRegx.test(ch)){
			num += ch;
			if(hasExp && !expEnd){
				expEnd = true;
			}
		}else if(ch === '.'){
			// 如果已经有小数点或者e就不再读取
			if(hasPoint || hasExp){
				break;
			}
			num += ch;
			hasPoint = true
		}else if(ch === 'e'){
			if(hasExp){ // 如果已经有e就报错
				this.raise(this.start, 'Invalid or unexpected token')
			}else{
				num += ch;
				nextCh = this.input.charAt(this.pos + 1);
				if(nextCh === '+' || nextCh === '-'){
					num += nextCh;
					this.pos++;
				}
				hasExp = true;
				expEnd = false;
			}
		}else if(identRegx.test(ch)){ // 数字之后不能接标识符
			this.raise(this.start, 'Invalid or unexpected token')
		}else{
			break;
		}
	}while(++this.pos < this.input.length);

	// 结束时，还要检查是否完整
	if(hasExp && !expEnd){
		this.raise(this.start, 'Invalid or unexpected token')
	}

	return this.finishToken(types.num, Number(num));
}

/* 读取一个词 */
tokenizer.readWord = function (ch){
	var word = ch, type;

	ch = this.input.charAt(++this.pos);
	while(this.pos < this.input.length && identRegx.test(ch)){
		word += ch;
		ch = this.input.charAt(++this.pos);
	}

	if(kwOprRegx.test(word)){     // 关键词操作符 in|instanceof|typeof|void|delete|new
		type = types.operator;
	}else if(word in specialVar){ // 特殊的变量 true|false|undefined|null
		type = types[word];
		word = specialVar[word];
	}else if(word === 'this'){    // this
		type = types.this;
	}else if(kwRegx.test(word)){  // 关键词
		type = types.keyword;
	}else{                        // 普通变量
		type = types.name;
	}
	return this.finishToken(type, word);
}

/* 读取一个字符串 */
tokenizer.readString = function(quote){
	var str = '', escape = false;

	while(true){
		if(++this.pos >= this.input.length){ this.raise(this.start, 'Unterminated string constant'); }
		var ch = this.input.charAt(this.pos);
		if(escape){
			if(ch === 'u'){
				str += this.readUnicode();
			}else if(ch in ESCAPE){
				str += ESCAPE[ch];
			}else{
				str += ch;
			}
			escape = false;
		}else if(ch === '\\'){
			escape = true;
		}else if(ch === quote){
			this.pos++;
			break;
		}else{
			str += ch
		}
	}

	return this.finishToken(types.string, str);
}

/* 读取一个unicode字符 */
tokenizer.readUnicode = function(){
	var hex = this.input.substr(this.pos+1, 4);

	if(!/[0-9a-f]{4}/.test(hex)){
		this.raise(this.start, 'Invaild Unicode char');
	}

	this.pos += 4;
	return String.fromCharCode(parseInt(hex, 16));
}


tokenizer.raise = function (pos, msg){
	var args = slice.call(arguments, 2),
			regx = /\{(\d+)\}/g,
			loc  = this.position(this.pos);

	msg = msg.replace(regx, function(match, num){
		return args[parseInt(num)];
	})
	msg += ' ('+ loc.line +':'+ loc.column + ')';

	var err = new SyntaxError(msg);
	err.pos = pos; err.loc = loc; err.raiseAt = this.pos;
	throw err;
}

tokenizer.finishToken = function(type, val) {
  this.end = this.pos;
  this.endLoc = this.curPosition();
  this.type = type;
  this.value = val;
  return {type: type.label, val: val};
};


/* 用于处理token位置 */

function Position(line, col){
	this.line = line;
	this.column = col; 
}


function getLineInfo(input, offset) {
  for (var line = 1, cur = 0;;) {
    lineBreakGRegx.lastIndex = cur;
    var match = lineBreakGRegx.exec(input);
    if (match && match.index < offset) {
      ++line;
      cur = match.index + match[0].length;
    } else {
      return new Position(line, offset - cur)
    }
  }
}

var position = Parser.prototype;

position.curPosition = function(){
	return getLineInfo(this.input, this.pos);
}

position.position = function(pos){
	return getLineInfo(this.input, pos);
}

function parse(input){
	return (new Parser(input)).parse();
}

var version = '1.0.0';

exports.version = version;
exports.parse = parse;


})));
