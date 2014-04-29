var chai = require('chai')
  , redis = require('redis').createClient()
  , promised = require('chai-as-promised')
  , subject = require('../')
  , expect = chai.expect

chai.use(promised)
chai.use(require('sinon-chai'))

describe('rollout', function () {
  var rollout

  beforeEach(function () {
    rollout = subject(redis)
  })

  afterEach(function (done) {
    redis.flushdb(done)
  })

  it('should work', function (done) {
    // var stub = sinon.stub(rollout, 'val_to_percent', function(val) {
    //   return 51.000
    // })
    rollout.handler('secret_feature', {
      employee: {
        percentage: 100,
        condition: function (val) {
          return val.match(/@expa\.com$/)
        }
      }
    })

    setTimeout(function () {
      var out = rollout.get('secret_feature', 123, {
        employee: 'ded@expa.com'
      })
      expect(out).to.be.fulfilled.notify(done)
    }, 500)
  })
})
