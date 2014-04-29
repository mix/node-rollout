var chai = require('chai')
  , sinon = require('sinon')
  , redis = require('redis').createClient()
  , promised = require('chai-as-promised')
  , v = require('valentine')
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
    rollout.handler('secret_feature', {
      employee: {
        percentage: 100,
        condition: function (val) {
          return val.match(/@expa\.com$/)
        }
      }
    })
    var out = rollout.get('secret_feature', 123, {
      employee: 'ded@expa.com'
    })
    expect(out).to.be.fulfilled.notify(done)

  })
  it('should reject if not in allowed percentage', function (done) {
    var stub = sinon.stub(rollout, 'val_to_percent', function (val) {
      return 51.001
    })
    rollout.handler('another_feature', {
      id: {
        percentage: 51.000
      }
    })
    var out = rollout.get('another_feature', 123)
    expect(out).to.be.rejected.notify(done)
    stub.restore()
  })
  it('should be able to update a key', function (done) {
    var stub = sinon.stub(rollout, 'val_to_percent', function (val) {
      return 50
    })
    rollout.handler('button_test', {
      id: {
        percentage: 100
      }
    })
    v.waterfall(
      function (f) {
        rollout.on('ready', function () {
          var out = rollout.get('button_test', 123)
          expect(out).to.be.fulfilled
          f(null)
        })
      },
      function (f) {
        rollout.update('button_test', {
          id: {
            percentage: 49
          }
        })
        .then(function () {
          var out = rollout.get('button_test', 123)
          expect(out).to.be.rejected.notify(f)
        })
      },
      function (err) {
        done(err)
        stub.restore()
      }
    )

  })
})
