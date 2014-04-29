var crypto = require('crypto')
  , util = require('util')
  , when = require('when')
  , EventEmitter = require('events').EventEmitter
  , alpha = 'abcdefghijklmnopqrstuvwxyz'.split('')
  , letters = /([a-z])/g

function defaultCondition() {
  return true
}

module.exports = function (client) {
  return new Rollout(client)
}

function Rollout(client) {
  EventEmitter.call(this)
  this.client = client
  this._handlers = {}
}

util.inherits(Rollout, EventEmitter)

Rollout.prototype.handler = function (key, flags) {
  var self = this
  self._handlers[key] = flags
  var orig_percentages = []
  var keys = Object.keys(flags).map(function (k) {
    orig_percentages.push(flags[k].percentage)
    return key + ':' + k
  })
  self.client.mget(keys, function (err, percentages) {
    percentages.forEach(function (p, i) {
      if (p === null) {
        var val = Math.max(0, Math.min(100, orig_percentages[i] || 0))
        self.client.set(keys[i], val, function () {
          self.emit('ready')
        })
      } else {
        self.emit('ready')
      }
    })
  })
}

Rollout.prototype.get = function (key, id, opt_values) {
  var flags = this._handlers[key]
  var likely = this.val_to_percent(key + id)
  if (!opt_values) opt_values = {
    id: id
  }
  return when.promise(function (resolve, reject) {
    var keys = Object.keys(flags).map(function (k) {
      return key + ':' + k
    })
    this.client.mget(keys, function (err, percentages) {
      var i = 0
      for (var modifier in flags) {
        // in the circumstance that the key is not found, default to original value
        if (percentages[i] === null) {
          percentages[i] = flags[modifier].percentage
        }
        if (!flags[modifier].condition) flags[modifier].condition = defaultCondition
        if (flags[modifier].condition(opt_values[modifier]) && likely < percentages[i]) return resolve(true)
      }
      reject(new Error('rejected'))
    })
  }.bind(this))
}

Rollout.prototype.update = function (key, percentage_map) {
  var self = this
  return when.promise(function (resolve) {
    var keys = []
    for (var k in percentage_map) {
      keys.push(key + ':' + k, percentage_map[k].percentage)
    }
    self.client.mset(keys, resolve)
  })
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
