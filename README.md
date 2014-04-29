
## API

### `rollout.get(key, uid, values)`
``` js
/**
 * @param {String} key The rollout feature key. Eg "new_homepage"
 * @param {String} uid The identifier of which will determine likelyhood of falling in rollout. Typically a user id.
 * @param {Object} values A lookup object with default percentages and conditions
 */
```

## Examples

``` js
// configuration.js
var rollout = require('node-rollout')
rollout.handler('new_homepage', {
  id: {
    percentage: 1
  },
  email: {
    percentage: 100,
    condition: function (val) {
      return val.match(/@company-email\.com$/)
    }
  },
  geo: {
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
  rollout.get('new_homepage', req.user.id, {
    email: req.user.email,
    geo: [37.12, -122.23]
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
