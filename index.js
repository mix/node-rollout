var crypto = require('crypto')
var when = require('when')
var alpha = 'abcdefghijklmnopqrstuvwxyz'.split('')
var letters = /([a-z])/g
var handlers = {}

function val_to_percent(text) {
  var n = crypto.createHash('md5').update(text).digest('hex').replace(letters, function (_, letter) {
    return alpha.indexOf(letter)
  })
  return parseFloat(n.substr(0, 2) + '.' + n.substr(2, 3))
}

exports.handler = function (key, flags) {
  handlers[key] = flags
  var orig_percentages = []
  var keys = Object.keys(flags).map(function (k) {
    orig_percentages.push(flags[k].percentage)
    return key + ':' + k
  })
  client.mget(keys, function (err, percentages) {
    percentages.forEach(function (p, i) {
      if (p === null) {
        var val = Math.max(0, Math.min(100, orig_percentages[i] || 0))
        client.set(keys[i], val)
      }
    })
  })
}

exports.get = function (key, id, values) {
  var flags = handlers[key]
  var likely = val_to_percent(key + id)
  return when.promise(function (resolve, reject) {
    var keys = Object.keys(flags).map(function (k) {
      return key + ':' + k
    })
    client.mget(keys, function (err, percentages) {
      var i = 0
      for (var modifier in flags) {
        if (flags[modifier].condition) {
          if (flags[modifier].condition(values[modifier]) && likely <= percentages[i]) return resolve()
        } else if (likely <= percentages[i]) return resolve()
      }
      reject()
    })
  })
}

exports.update = function (key, percentage_map) {
  var keys = []
  for (var k in percentage_map) {
    keys.push(key + ':' + k, percentage_map[k])
  }
  client.mset(keys)
}
