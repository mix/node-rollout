var crypto = require('crypto')
var when = require('when')
var alpha = 'abcdefghijklmnopqrstuvwxyz'.split('')
var letters = /([a-z])/g

module.exports = function (client) {
  return new Rollout(client)
}

function Rollout(client) {
  this.client = client
  this._handlers = {}
}

Rollout.prototype.handler = function (key, flags) {
  this._handlers[key] = flags
  var orig_percentages = []
  var keys = Object.keys(flags).map(function (k) {
    orig_percentages.push(flags[k].percentage)
    return key + ':' + k
  })
  this.client.mget(keys, function (err, percentages) {
    percentages.forEach(function (p, i) {
      if (p === null) {
        var val = Math.max(0, Math.min(100, orig_percentages[i] || 0))
        this.client.set(keys[i], val)
      }
    }, this)
  }.bind(this))
}

Rollout.prototype.get = function (key, id, values) {
  var flags = this._handlers[key]
  var likely = this.val_to_percent(key + id)
  return when.promise(function (resolve, reject) {
    var keys = Object.keys(flags).map(function (k) {
      return key + ':' + k
    })
    this.client.mget(keys, function (err, percentages) {
      var i = 0
      for (var modifier in flags) {
        if (flags[modifier].condition(values[modifier]) && likely < percentages[i]) return resolve()
      }
      reject(new Error('rejected'))
    })
  }.bind(this))
}

Rollout.prototype.update = function (key, percentage_map) {
  var keys = []
  for (var k in percentage_map) {
    keys.push(key + ':' + k, percentage_map[k])
  }
  this.client.mset(keys)
}

Rollout.prototype.mods = function (name, callback) {
  var keys = []
  var names = []
  for (var flag in this._handlers[name]) {
    keys.push(name + ':' + flag)
    names.push(flag)
  }
  this.client.mget(keys, function (err, values) {
    var flags = {}
    values.forEach(function (val, i) {
      flags[names[i]] = val
    })
    callback(flags)
  })
}

Rollout.prototype.flags = function () {
  return Object.keys(this._handlers)
}

Rollout.prototype.val_to_percent = function (text) {
  var n = crypto.createHash('md5').update(text).digest('hex').replace(letters, function (_, letter) {
    return alpha.indexOf(letter)
  })
  return parseFloat(n.substr(0, 2) + '.' + n.substr(2, 3))
}
