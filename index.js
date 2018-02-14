var crypto = require('crypto')
  , util = require('util')
  , Promise = require('bluebird')
  , EventEmitter = require('events').EventEmitter

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
  var configPercentages = []
  var configKeys = Object.keys(flags).map(function (mod) {
    configPercentages.push(flags[mod].percentage)
    return key + ':' + mod
  })
  return getRedisKeys(this.client, configKeys)
  .then(function(persistentPercentages) {
    var persistKeys = []
    persistentPercentages.forEach(function (p, i) {
      if (p === null) {
        var val = clampPercentage(configPercentages[i])
        persistKeys.push(configKeys[i], val)
      }
    })
    if (persistKeys.length) {
      return setRedisKeys(self.client, persistKeys)
      .then(function() { self.emit('ready') })
    } else {
      self.emit('ready')
    }
  })
}

Rollout.prototype.multi = function (keys) {
  var multi = this.client.multi()
  // Accumulate get calls into a single "multi" query
  var promises = keys.map(function (k) {
    return this.get(k[0], k[1], k[2], multi).reflect()
  }.bind(this))
  // Perform the batch query
  return new Promise(function (resolve, reject) {
    multi.exec(promiseCallback(resolve, reject))
  })
  .then(function () {
    return Promise.all(promises)
  })
}

Rollout.prototype.get = function (key, id, opt_values, multi) {
  opt_values = opt_values || { id: id }
  opt_values.id = opt_values.id || id
  var flags = this._handlers[key]
  var likely = this.val_to_percent(key + id)
  var keys = Object.keys(flags).map(function (mod) {
    return key + ':' + mod
  })
  return getRedisKeys(multi || this.client, keys)
  .then(function (percentages) {
    var i = 0
    var deferreds = []
    var output
    for (var modifier in flags) {
      // in the circumstance that the key is not found, default to original value
      if (percentages[i] === null) {
        percentages[i] = flags[modifier].percentage
      }
      if (likely < percentages[i]) {
        if (!flags[modifier].condition) {
          flags[modifier].condition = defaultCondition
        }
        output = flags[modifier].condition(opt_values[modifier])
        if (output) {
          if (typeof output.then === 'function') {
            // Normalize thenable to Bluebird Promise
            // Reflect the Promise to coalesce rejections
            deferreds.push(Promise.resolve(output).reflect())
          } else {
            return true
          }
        }
      }
      i++
    }
    if (deferreds.length) {
      return Promise.all(deferreds)
      .then(function (results) {
        var resultPromise, resultValue
        for (var i = 0, len = results.length; i < len; i++) {
          resultPromise = results[i]
          // Treat rejected conditions as inapplicable modifiers
          if (resultPromise.isFulfilled()) {
            resultValue = resultPromise.value()
            // Treat resolved conditions with non-false values as affirmative
            // (This is to handle `Promise.resolve()` and `Promise.resolve(null)`)
            if (resultValue !== false) {
              return true
            }
          }
        }
        return Promise.reject()
      })
    }
    throw new Error('Not inclusive of any partition for key[' + key + '] id[' + id + ']')
  })
}

Rollout.prototype.update = function (key, percentage_map) {
  var keys = []
  for (var k in percentage_map) {
    keys.push(key + ':' + k, percentage_map[k])
  }
  return setRedisKeys(this.client, keys)
}

Rollout.prototype.mods = function (flagName) {
  var keys = []
  var modNames = []
  for (var mod in this._handlers[flagName]) {
    keys.push(flagName + ':' + mod)
    modNames.push(mod)
  }
  return getRedisKeys(this.client, keys)
  .then(function (values) {
    var flags = {}
    values.forEach(function (val, i) {
      flags[modNames[i]] = val
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

function defaultCondition() {
  return true
}

function clampPercentage(val) {
  return Math.max(0, Math.min(100, +(val || 0)))
}

function getRedisKeys(client, keys) {
  return new Promise(function (resolve, reject) {
    client.mget(keys, promiseCallback(resolve, reject))
  })
}

function setRedisKeys(client, keys) {
  return new Promise(function (resolve, reject) {
    client.mset(keys, promiseCallback(resolve, reject))
  })
}

function promiseCallback(resolve, reject) {
  return function (err, result) {
    if (err) {
      return reject(err)
    }
    resolve(result)
  }
}
