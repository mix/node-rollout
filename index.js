var crypto = require('crypto')
  , util = require('util')
  , Promise = require('bluebird')
  , EventEmitter = require('events').EventEmitter

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
  this._handlers[key] = flags
  var orig_percentages = []
  var keys = Object.keys(flags).map(function (k) {
    orig_percentages.push(flags[k].percentage)
    return key + ':' + k
  })
  this.client.mget(keys, function (err, percentages) {
    var _keys = []
    var nullKey = false
    percentages.forEach(function (p, i) {
      if (p === null) {
        var val = Math.max(0, Math.min(100, orig_percentages[i] || 0))
        nullKey = true
        _keys.push(keys[i], val)
      }
    })
    if (nullKey) {
      self.client.mset(_keys, function () {
        self.emit('ready')
      })
    } else {
      self.emit('ready')
    }
  })
}

Rollout.prototype.multi = function (keys) {
  var multi = this.client.multi()
  var promises = keys.map(function (k) {
    return this.get(k[0], k[1], k[2], multi)
  }.bind(this))
  return new Promise(function (resolve, reject) {
    multi.exec(function (err, result) {
      if (err) return reject(err)
      resolve(result)
    })
  })
  .then(function () {
    return promises.map(function (p) { return p.reflect() })
  })
}

Rollout.prototype.get = function (key, id, opt_values, multi) {
  var flags = this._handlers[key]
  var likely = this.val_to_percent(key + id)
  var _id = {
    id: id
  }
  if (!opt_values) opt_values = _id
  if (!opt_values.id) opt_values.id = id
  var keys = Object.keys(flags).map(function (k) {
    return key + ':' + k
  })
  var client = multi || this.client
  return new Promise(function (resolve, reject) {
    client.mget(keys, function (err, result) {
      if (err) return reject(err)
      resolve(result)
    })
  })
  .then(function (percentages) {
    var i = 0
    var deferreds = []
    for (var modifier in flags) {
      // in the circumstance that the key is not found, default to original value
      if (percentages[i] === null) {
        percentages[i] = flags[modifier].percentage
      }
      if (likely < percentages[i]) {
        if (!flags[modifier].condition) flags[modifier].condition = defaultCondition
        var output = flags[modifier].condition(opt_values[modifier])
        if (output) {
          if (typeof output.then === 'function') deferreds.push(output)
          else return true
        }
      }
      i++
    }
    if (deferreds.length) {
      return Promise.any(deferreds)
    }
    throw new Error('Conditions do not exist')
  }.bind(this))
}

Rollout.prototype.update = function (key, percentage_map) {
  var keys = []
  for (var k in percentage_map) {
    keys.push(key + ':' + k, percentage_map[k])
  }
  return new Promise(function (resolve, reject) {
    this.client.mset(keys, function (err, result) {
      if (err) return reject(err)
      resolve(result)
    })
  }.bind(this))
}

Rollout.prototype.mods = function (name) {
  var keys = []
  var names = []
  for (var flag in this._handlers[name]) {
    keys.push(name + ':' + flag)
    names.push(flag)
  }
  return new Promise(function (resolve, reject) {
    this.client.mget(keys, function (err, result) {
      if (err) return reject(err)
      resolve(result)
    })
  }.bind(this))
    .then(function (values) {
      var flags = {}
      values.forEach(function (val, i) {
        flags[names[i]] = val
      })
      return flags
    })
}

Rollout.prototype.flags = function () {
  return Object.keys(this._handlers)
}

Rollout.prototype.val_to_percent = function (text) {
  var n = crypto.createHash('md5').update(text).digest('hex')
  n = n.slice(0, n.length/2)
  return parseInt(n, 16) / parseInt(n.split('').map(function () { return 'f' }).join(''), 16) * 100
}
