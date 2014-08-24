## Node Rollout
Feature rollout management for Node.js built on Redis

``` sh
npm install node-rollout --save
```

``` js
// configuration.js
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
      return val.match(/@company-email\.com$/)
    }
  },
  // 50% of users in San Francisco
  geo_sf: {
    percentage: 50,
    condition: function (val) {
      return geolib.getDistance([val.lat, val.lon], [37.768, -122.426], 'miles') < 7
    }
  }
})

module.exports = rollout
```

``` js
// A typical Express app
...
var rollout = require('./configuration')

app.get('/', new_homepage, old_homepage)

function new_home_page(req, res, next) {
  rollout.get('new_homepage', req.current_user.id, {
    employee: req.current_user.email,
    geo: [req.current_user.lat, req.current_user.lon]
  })
    .then(function () {
      res.render('home/new-index')
    })
    .otherwise(next)
}

function old_home_page (req, res, next) {
  res.render('home/index')
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
  .otherwise(function () {
    render('red_button')
  })

rollout.get('another_feature', 123, {
  employee: 'user@example.org'
})
  .then(function () {
    render('blue_button')
  })
  .otherwise(function () {
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
      console.log(i.state) // 'fulfilled' || 'rejected'
    })
  })

rollout.get('another_feature', 123, {
  employee: 'user@example.org'
})
  .then(function () {
    render('blue_button')
  })
  .otherwise(function () {
    render('red_button')
  })
```

#### `rollout.handler(key, flags)`
 - `key`: `String` The rollout feature key
 - `flags`: `Object`
  - `flagname`: `String` The name of the flag. Typically `id`, `employee`, `ip`, or any other arbitrary item you would want to modify the rollout
    - `percentage`: `NumberRange` from 0 - 100. Can be set to a third decimal place such as `0.001` or `99.999`. Or simply `0` to turn off a feature, or `100` to give a feature to all users
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
 - `flags`: `Object` mapping of `flagname`:`String` to `percentage`:`Number`
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
rollout.mods('new_homepage').then(function (mods) {
  flags.employee == 100
  flags.geo_sf == 50.000
  flags.id == 33.333
})
```

#### `rollout.flags()`

``` js
rollout.flags() == ['new_homepage', 'other_secret_feature']
```

### Tests
see [tests/index.js](tests/index.js)

``` sh
make test
```

### License MIT

Happy rollout!
