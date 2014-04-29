## Node Rollout
Feature rollout management for Node.js built on Redis

``` sh
npm install node-rollout --save
```

``` js
// configuration.js
var rollout = require('node-rollout')
rollout.handler('new_homepage', {
  id: {
    // 1% of regular users
    percentage: 1
  },
  email: {
    // All users with the company email
    percentage: 100,
    condition: function (val) {
      return val.match(/@company-email\.com$/)
    }
  },
  geo: {
    // 50% of users in San Francisco
    percentage: 50,
    condition: function (val) {
      return distance_between([val.lat, val.lon], [37.43, -121.84], 'miles') < 7
    }
  }
})
```

``` js
// A typical Express app
...
require('./configuration')

app.get('/', new_homepage, old_homepage)

function new_home_page(req, res, next) {
  rollout.get('new_homepage', current_user.id, {
    email: current_user.email,
    geo: [current_user.lat, current_user.lon]
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

#### `rollout.get(key, uid, values)`

 - `key`: `String` The rollout feature key. Eg "new_homepage"
 - `uid`: `String` The identifier of which will determine likelyhood of falling in rollout. Typically a user id.
 - `values`: `Object` A lookup object with default percentages and conditions

#### `rollout.handler(key, {flags}.flagname[percentage&condition])`
 - `key`: 'String' The rollout feature key
 - `flags`: `Object`
  - `flagname`: `String` The name of the flag. Typically `id`, `email`, `ip`, or any other arbitrary item you would want to modify the rollout
    - `percentage`: `NumberRange` from 0 - 100. Can be set to a third decimal place such as `0.001` or `99.999`. Or simply `0` to turn off a feature, or `100` to give a feature to all users
    - `condition`: `Function` a white-listing method by which you can add users into a group. See examples.
