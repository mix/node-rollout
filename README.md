## Node Rollout
[![CircleCI](https://circleci.com/gh/mix/node-rollout.svg?style=svg)](https://circleci.com/gh/mix/node-rollout)
[![Maintainability](https://api.codeclimate.com/v1/badges/1cf0304dee9b1f264a64/maintainability)](https://codeclimate.com/github/mix/node-rollout/maintainability)
Feature rollout management for Node.js built on Redis

### Example Usage

#### Installation

``` sh
npm install node-rollout --save
```

#### Basic Configuration

``` js
// basic_configuration.js
var client = require('redis').createClient()
var rollout = require('node-rollout')(client)
rollout.handler('new_homepage', {
  // 1% of regular users
  id: {
    percentage: 1
  },
  // All users with the company email
  employee: {
    percentage: 100,
    condition: function (val) {
      return /@company-email\.com$/.test(val)
    }
  },
  // 50% of users in San Francisco
  geo_sf: {
    percentage: 50,
    condition: function (val) {
      return geolib.getDistance([val.lat, val.lon], [37.768, -122.426], 'miles') < 7
    }
  },
  // Asynchronous database lookup
  admin: {
    percentage: 100,
    condition: function (val) {
      return db.lookupUser(val)
      .then(function (user) {
        return user.isAdmin()
      })
    }
  }
})

module.exports = rollout
```

``` js
// A typical Express app demonstrating rollout flags
...
var rollout = require('./basic_configuration')

app.get('/', new_homepage, old_homepage)

function new_home_page(req, res, next) {
  rollout.get('new_homepage', req.current_user.id, {
    employee: req.current_user.email,
    geo: [req.current_user.lat, req.current_user.lon],
    admin: req.current_user.id
  })
  .then(function () {
    res.render('home/new-index')
  })
  .catch(next)
}

function old_home_page (req, res, next) {
  res.render('home/index')
}

```

#### Experiment groups

``` js
// experiment_groups_configuration.js
var client = require('redis').createClient()
var rollout = require('node-rollout')(client)
// An experiment with 3 randomly-assigned groups
rollout.handler('homepage_variant', {
  versionA: {
    percentage: { min: 0, max: 33 }
  },
  versionB: {
    percentage: { min: 33, max: 66 }
  },
  versionC: {
    percentage: { min: 66, max: 100 }
  }
})

module.exports = rollout
```

``` js
// A typical Express app demonstrating experiment groups
...
var rollout = require('./experiment_groups_configuration')

app.get('/', homepage)

function homepage(req, res, next) {
  rollout.get('homepage_variant', req.current_user.id)
  .then(function (version) {
    console.assert(/^version(A|B|C)$/.test(version) === true)
    res.render('home/' + version)
  })
}

```

### API Options

#### `rollout.get(key, uid, opt_values)`

 - `key`: `String` The rollout feature key. Eg "new_homepage"
 - `uid`: `String` The identifier of which will determine likelyhood of falling in rollout. Typically a user id.
 - `opt_values`: `Object` *optional* A lookup object with default percentages and conditions. Defaults to `{id: args.uid}`
 - returns `Promise`

``` js
rollout.get('button_test', 123)
.then(function () {
  render('blue_button')
})
.catch(function () {
  render('red_button')
})

rollout.get('another_feature', 123, {
  employee: 'user@example.org'
})
.then(function () {
  render('blue_button')
})
.catch(function () {
  render('red_button')
})
```

#### `rollout.multi(keys)`
The value of this method lets you do a batch redis call (using `redis.multi()`) allowing you to get multiple flags in one request

 - `keys`: `Array` A list of tuples containing what you would ordinarily pass to `get`
 - returns `SettlePromise`

``` js
rollout.multi([
  ['onboarding', 123, {}],
  ['email_inviter', 123, {}],
  ['facebook_chat', 123, {
    employees: req.user.email // 'joe@company.com'
  }]
])
.then(function (results) {
  results.forEach(function (r) {
    console.log(i.isFulfilled()) // Or 'isRejected()'
  })
})

rollout.get('another_feature', 123, {
  employee: 'user@example.org'
})
.then(function () {
  render('blue_button')
})
.catch(function () {
  render('red_button')
})
```

#### `rollout.handler(key, flags)`
 - `key`: `String` The rollout feature key
 - `flags`: `Object`
  - `flagname`: `String` The name of the flag. Typically `id`, `employee`, `ip`, or any other arbitrary item you would want to modify the rollout
    - `percentage`:
      - `Number` from `0` - `100`. Can be set to a third decimal place such as `0.001` or `99.999`. Or simply `0` to turn off a feature, or `100` to give a feature to all users
      - `Object` containing `min` and `max` keys representing a range of `Number`s between `0` - `100`
    - `condition`: `Function` a white-listing method by which you can add users into a group. See examples.
      - if `condition` returns a `Promise` (*a thenable object*), then it will use the fulfillment of the `Promise` to resolve or reject the `handler`

``` js
rollout.handler('admin_section', {
  // 0% of regular users. You may omit `id` since it will default to 0
  id: {
    percentage: 0
  },
  // All users with the company email
  employee: {
    percentage: 100,
    condition: function (val) {
      return val.match(/@company-email\.com$/)
    }
  },
  // special invited people
  contractors: {
    percentage: 100,
    condition: function (user) {
      return new Promise(function (resolve, reject) {
        redisClient.get('contractors:' + user.id, function (err, is_awesome) {
          is_awesome ? resolve() : reject()
        })
      })
    }
  }
})
```

#### `rollout.update(key, flags)`
 - `key`: `String` The rollout feature key
 - `flags`: `Object` mapping of `flagname`:`String` to `percentage`
   - `percentage`:
     - `Number` from `0` - `100`. Can be set to a third decimal place such as `0.001` or `99.999`. Or simply `0` to turn off a feature, or `100` to give a feature to all users
     - `Object` containing `min` and `max` keys representing a range of `Number`s between `0` - `100`
 - returns `Promise`

``` js
rollout.update('new_homepage', {
  id: 33.333,
  employee: 50,
  geo_sf: 25
})
.then(function () {
  // values have been updated
})
```

#### `rollout.mods(flagname)`
  - `flagname`: `String` the rollout feature key
  - returns `Promise`: resolves with the flags, their names, and values

``` js
rollout.mods('new_homepage')
.then(function (mods) {
  console.assert(mods.employee == 100)
  console.assert(mods.geo_sf == 50.000)
  console.assert(mods.id == 33.333)
})
```

#### `rollout.flags()`
  - return `Promise`: resolves with an array of configured rollout flag names

``` js
rollout.flags()
.then(function (flags) {
  console.assert(flags[0] === 'new_homepage')
  console.assert(flags[1] === 'other_secret_feature')
})
```

### Tests
see [tests/index-test.js](tests/index-test.js)

``` sh
make test
```

### User Interface
Consider using [rollout-ui](https://github.com/ded/rollout-ui) to administrate the values of your rollout flags in real-time (as opposed to doing a full deploy). It will make your life much easier and you'll be happy :)

### License MIT

Happy rollout!
