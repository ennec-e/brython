var $B = __BRYTHON__,
    Store = $B.ast.Store

function _PyPegen_set_expr_context(p, a, ctx){
    console.log('set context', p, a, ctx)
    a.ctx = new ctx()
    return a
}

function _PyPegen_singleton_seq(p, a){
    return [a]
}

function _PyPegen_seq_flatten(p, seqs){
    console.log('flatten', seqs)
    return seqs
}

function _PyPegen_make_module(p, a){
    var res = new $B.ast.Module(a)
    return res
}

function _PyAST_Assign(a, b, tc, EXTRA){
    console.log('Assign', a, b)
    var ast_obj = new $B.ast.Assign(a, b)
    return ast_obj
}

function NEW_TYPE_COMMENT(x){
    return x
}

var debug = 0

var inf = Number.POSITIVE_INFINITY

// Python keywords don't match NAME rules, so that "pass = 7" is illegal
// The list doesn't include 'case' and 'match' that are 'soft keywords'
// in PEP 634
var keywords = ['and', 'as', 'elif', 'for', 'yield', 'while', 'assert', 'or',
    'continue', 'lambda', 'from', 'class', 'in', 'not', 'finally', 'is',
    'except', 'global', 'return', 'raise', 'break', 'with', 'def',
    'try', 'if', 'else', 'del', 'import', 'nonlocal', 'pass'
    ]

function Parser(src){
  this.state = {type: 'program', pos: 0}
  this.src = src
}

Parser.prototype.feed = function(){
  var tokens = []
  for(var token of __BRYTHON__.tokenizer(this.src)){
      if(['COMMENT', 'NL', 'ENCODING', 'TYPE_COMMENT'].indexOf(token[0]) == -1){
          tokens.push(token)
      }
  }
  return parse(grammar, tokens, this.src)
}

function MemoEntry(match, end){
    this.match = match
    this.position = end
}

var memo = {},
    rules = {}

function clear_memo(){
    for(var key in memo){
        delete memo[key]
    }
}

function get_memo(rule, position){
    if(memo[rule.name] === undefined ||
            memo[rule.name][position] === undefined){
        return null
    }
    var m = memo[rule.name][position]
    if(m.match === FAIL){
        return FAIL
    }
    return m
}

function set_memo(rule, position, value){
    memo[rule.name] = memo[rule.name] || {}
    memo[rule.name][position] = value
}

var FAIL = {name: 'FAIL'},
    FROZEN_FAIL = {name: 'FROZEN_FAIL'}

function LeftRecursion(detected){
    this.type = 'LeftRecursion'
    this.detected = detected // true or false
}

function eval_body(rule, tokens, position){
    var result,
        start = position,
        join_position = false
    if(! rule.repeat){
        result = eval_body_once(rule, tokens, position)
    }else{
        var matches = [],
            start = position
        while(matches.length < rule.repeat[1]){
            var match = eval_body_once(rule, tokens, position)
            if(match === FAIL){
                if(join_position){
                    result = {rule, matches, start, end: join_position - 1}
                    join_position = false
                    position = join_position - 1
                }else if(matches.length >= rule.repeat[0]){
                    // Enough repetitions
                    result = {rule, matches, start, end: position}
                }else{
                    result = FAIL
                }
                break
            }
            matches.push(match)
            // If the rule is of the form "s.e" :
            // - if the next token matches "s", increment position and remain
            //   in the loop. Keep track of the position that matches "s". If
            //   the next tokens don't match the rule, the position will be
            //   reset to the position of the "s" character
            // - else break
            if(rule.join){
                if(tokens[match.end][1] == rule.join){
                    position = match.end + 1
                    join_position = position
                }else{
                    position = match.end
                    break
                }
             }else{
                 join_position = false
                 position = match.end
             }
        }
        if(! result){
            result = {rule, start, matches, end: position}
        }
    }
    if(rule.lookahead){
        switch(rule.lookahead){
            case 'positive':
                if(result !== FAIL){
                    result.end = result.start // don't consume input
                }
                break
            case 'negative':
                if(result === FAIL){
                    result = {rule, start, end: start}
                }else{
                    result = FAIL
                }
                break
        }
    }
    if(result.matches){
        for(var m of result.matches){
            if(m.from_choices && m.from_choices.alias){
                console.log('--', m.from_choices.alias)
            }
        }
    }
    return result
}

function eval_body_once(rule, tokens, position){
    if(debug){
        console.log('eval_body_once of rule', rule, 'position', position)
    }
    if(rule.choices){
        for(var i = 0, len = rule.choices.length; i < len; i++){
            var choice = rule.choices[i]
            var match = eval_body(choice, tokens, position)
            if(match === FROZEN_FAIL){
                // if a choice with a ~ fails, don't try other alternatives
                return FAIL
            }else if(match !== FAIL){
                match.rank = i
                return match
            }
        }
        return FAIL
    }else if(rule.items){
        var start = position,
            matches = [],
            frozen_choice = false // set to true if we reach a COMMIT_CHOICE (~)
        for(var item of rule.items){
            if(item.type == 'COMMIT_CHOICE'){
                frozen_choice = true
            }
            var match = eval_body(item, tokens, position)
            if(item.debug){
                console.log('eval item', item, 'at position', position,
                    tokens[position], 'previous matches', matches,
                    'match', match)
            }
            if(match !== FAIL){
                matches.push(match)
                position = match.end
                if(match.end === undefined){
                    console.log('no end, rule', rule, 'item', item,
                        'result of eval_body', match)
                    alert()
                }
            }else{
                if(debug){
                    console.log('item', item, 'of sequence', rule, 'fails')
                }
                if(frozen_choice){
                    return FROZEN_FAIL
                }
                return FAIL
            }
        }
        return {rule, matches, start, end: position}
    }else if(rule.type == "rule"){
        return apply_rule(grammar[rule.name], tokens, position)
    }else if(rule.type == "string"){
        return tokens[position][1] == rule.value ?
            {rule, start: position, end: position + 1} :
            FAIL
    }else if(rule.type == 'COMMIT_CHOICE'){
        // mark current option as frozen
        return {rule, start: position, end: position}
    }else if(rule.type == 'NAME'){
        var test = tokens[position][0] == rule.type &&
            keywords.indexOf(tokens[position][1]) == -1 &&
            (rule.value === undefined ? true : tokens[position][1] == rule.value)
        return test ? {rule, start: position, end: position + 1} : FAIL
    }else{
        var test = tokens[position][0] == rule.type &&
          (rule.value === undefined ? true : tokens[position][1] == rule.value)
        return test ? {rule, start: position, end: position + 1} : FAIL
    }
}

function grow_lr(rule, tokens, position, m){
    // Called after eval_body(rule, position) produced a match and ignored
    // an option that referenced itself (recursion) because at that time,
    // memo(rule, position) was a LeftReference.
    //
    // m is the MemoEntry for (rule, position); m.match is the latest match,
    // m.pos is the last position in tokens
    //
    // apply_rule(rule, position) will return this match
    //
    // In each iteration of the "while" loop, we try again eval_body(),
    // which uses the MemoEntry m for the rule. This allows an
    // expression such as "1 + 2 + 3" to set a first match for "1 + 2",
    // then a second for "1 + 2 + 3"
    if(debug){
        console.log('grow_lr, rule', rule, position, 'current MemoEntry', m)
    }
    while(true){
        var match = eval_body(rule, tokens, position)
        if(match === FAIL || match.end <= m.end){
            break
        }
        m.match = match
        m.end = match.end
    }
    return m.match
}

function apply_rule(rule, tokens, position){
    // apply rule at position
    if(debug){
        console.log('apply rule', rule, position, 'memo', memo)
    }
    // search if result is in memo
    var memoized = get_memo(rule, position)
    if(memoized === null){
        // for left recursion, initialize with LeftRecursion set to false
        var LR = new LeftRecursion(false),
            m = new MemoEntry(LR, position)
        set_memo(rule, position, m)
        // evaluate body of rule
        // if the rule includes itself at the same position, it will be found
        // in memo as LR; LR.detected will be set to true and the branch of
        // eval_body containing rule will return FAIL, but eval_body can
        // match with another branch that doesn't contain rule
        var match = eval_body(rule, tokens, position)

        // change memo(rule, position) with result of match
        m.match = match
        m.end = match.end

        if(LR.detected && match !== FAIL){
            // recursion detected when executing eval_body
            // memo(rule, position) now contains the match with a branch
            // without recursion
            // grow_lr will try again at position, and use memo(rule, position)
            // to search a longer match
            return grow_lr(rule, tokens, position, m)
        }else{
            return match
        }
    }else{
        if(debug){
            console.log('read from memo', memoized)
        }
        if(memoized.match instanceof LeftRecursion){
            if(debug){
                console.log('recursion !')
            }
            memoized.match.detected = true
            return FAIL
        }else{
            if(memoized !== FAIL && memoized.match.start === undefined){
                console.log('pas de start', rule, position, memoized)
                alert()
            }
            return memoized === FAIL ? memoized : memoized.match
        }
    }
}

function parse(grammar, tokens, src){
    var position = 0,
        rule = grammar.file,
        match
    clear_memo()
    for(rule_name in grammar){
        grammar[rule_name].name = rule_name
        if(grammar[rule_name].choices){
            grammar[rule_name].choices.forEach(function(item, rank){
                item.parent_rule = rule_name
                item.rank = rank
            })
        }
    }
    while(position < tokens.length){
        match = apply_rule(rule, tokens, position)
        if(match === FAIL){
            console.log('rule', rule, 'fails')
            return
        }else{
            position = match.end
        }
    }
    console.log('parse succeeds !', match)
    console.log('make', make(match, src))
}

function show(match, tokens, level){
    if(match.from_choices && match.from_choices.alias){
        console.log('***', match.from_choices.alias)
    }
    level = level || 0
    var s = '',
        prefix = '  '.repeat(level),
        name = match.rule.name || match.rule.parent_rule,
        action = match.rule.action,
        alias = match.rule.alias,
        parent

    if(match.from_sequence){
        parent = match.from_sequence
    }else if(match.from_choices){
        parent = match.from_choices
        if(parent.alias){
            console.log('choices parent has alias', parent.alias)
            alert()
        }
    }
    if(parent && (parent.action || parent.alias)){
        s += prefix + '<parent>' +
             (parent.alias ? ' = ' + parent.alias : '') +
             (parent.action ? `{${parent.action}}` : '') + '\n'
    }
    s += prefix +
        (name === undefined ? '' : name) +
        (match.rank === undefined ? '' : ' #' + match.rank) +
        (alias ? ' = ' + alias : '') +
        (action ? ` {${action}}` : '') + '\n'
    level += 1

    if(match.matches){
        for(var match of match.matches){
            s += show(match, tokens, level)
        }
    }else{
        if(match.end > match.start){
            s += prefix
            if(['NAME', 'STRING', 'NUMBER', 'string'].indexOf(match.rule.type) > -1){
                s += match.rule.type + ' ' + tokens[match.start][1]
            }else{
                s += match.rule.type + ' ' + (match.rule.value || '') +
                    match.start + '-' + match.end
            }
            s += '\n'
        }
    }
    return s
}

function make(match, src){
    // match.rule succeeds; make() returns a value for the match, based on the
    // grammar action for the rule
    // If there is an explicit grammar action, it takes named arguments. The
    // names match the value of the sub-matches in the rule. make() returns
    // the evaluation of the grammar action.
    // Otherwise
    console.log('make', match)
    var rule = match.rule,
        names = {},
        p = {}

    // If there is an explicit action, get the names in the rule expression
    if(rule.action){
        console.log('rule has action', rule.action, 'get names')
        for(var i = 0; i < match.matches.length; i++){
            if(rule.items[i].alias){
                names[rule.items[i].alias] = make(match.matches[i], src)
            }
        }
        console.log('action', rule.action, 'names', names)
        for(var name in names){
            eval(`var ${name} = names.${name}`)
            console.log('eval of', name, eval(name))
        }
        var EXTRA = {lineno: 1},
            action = rule.action.trim()
        action = action.replace(/^\(.*?\)/, '')
        console.log('eval action', action)
        return eval(action)
    }else{
        // If rule has items, each submatch matches one of the items
        // Otherwise, rule.name is in the grammar and each submatch matches
        // the grammar rule
        if(rule.items){
            if(rule.repeat || rule.items.length > 1){
                var elts = []
                for(var i = 0; i < match.matches.length; i++){
                    elts.push(make(match.matches[i], src))
                }
                return {name: rule.alias, elts}
            }else{
                return make(match.matches[0], src)
            }
        }else{
            if(['NAME', 'NUMBER', 'STRING', 'string'].indexOf(rule.type) > -1){
                return {type: rule.type, value: src.substring(match.start, match.end)}
            }else if(grammar[rule.name] === undefined){
                console.log('anomalie', rule.name, 'not in grammar')
                alert()
            }
            if(rule.repeat){
                var elts = []
                for(var i = 0; i < match.matches.length; i++){
                    console.log('i', i,
                        'submatch', match.matches[i])
                    elts.push(make(match.matches[i], src))
                }
                return {name: rule.alias, elts}
            }else{
                return '<...>'
            }
        }
    }
    if(! rule.items){
        if(match.matches){
            for(var m of match.matches){
                make(m, src)
            }
        }
        return
    }else{
        for(var i = 0; i < match.matches.length; i++){
            if(rule.items[i].alias){
                names[rule.items[i].alias] = match.matches[i]
            }
            if(['NAME', 'NUMBER', 'STRING', 'string'].indexOf(rule.items[i].type) > -1){
                var m = match.matches[i]
                if(m.end > m.start){
                    console.log(rule.items[i].type, src.substring(m.start, m.end))
                }
            }
        }
        if(rule.action){
            for(var name in names){
                console.log(`var ${name} = make(names['${name}'])`, names[name])
                eval(`var ${name} = make(names['${name}'], src)`)
            }
        }else{
            console.log('no action, rule', rule, 'names', names)
            if(rule.alias){
                console.log('alias', rule.alias, 'for match', match)
            }
        }

        /*for(var m of match.matches){
            make(m, src)
        }*/
    }
}