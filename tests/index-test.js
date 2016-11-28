var chai = require('chai')
  , sinon = require('sinon')
  , v = require('valentine')
  , redis = require('redis').createClient()
  , Promise = require('bluebird')
  , promised = require('chai-as-promised')
  , rollout = require('../')
  , expect = chai.expect

chai.use(promised)
chai.use(require('sinon-chai'))

describe('rollout', function () {
  var subject

  beforeEach(function () {
    subject = rollout(redis)
  })

  afterEach(function (done) {
    redis.flushdb(done)
  })

  it('fulfills', function () {
    subject.handler('secret_feature', {
      employee: {
        percentage: 100,
        condition: function isCompanyEmail(val) {
          return val.match(/@expa\.com$/)
        }
      }
    })
    return expect(subject.get('secret_feature', 123, {
      employee: 'ded@expa.com'
    })).to.be.fulfilled
  })

  it('fulfills when condition returns a resolved promise', function () {
    subject.handler('promise_secret_feature', {
      beta_testa: {
        percentage: 100,
        condition: function () {
          return new Promise(function (resolve) {
            setTimeout(resolve, 10)
          })
        }
      }
    })
    return expect(subject.get('promise_secret_feature', 123, {
      beta_testa: 'foo'
    })).to.be.fulfilled
  })

  it('rejects when condition returns a rejected promise', function () {
    subject.handler('promise_secret_feature', {
      beta_testa: {
        percentage: 100,
        condition: function () {
          return Promise.reject()
        }
      }
    })
    return expect(subject.get('promise_secret_feature', 123, {
      beta_testa: 'foo'
    })).to.be.rejected
  })

  it('fulfills if `any` condition passes', function () {
    subject.handler('mixed_secret_feature', {
      beta_testa: {
        percentage: 100,
        condition: function () {
          return Promise.resolve()
        }
      },
      beta_testa1: {
        percentage: 0,
        condition: function () {
          return Promise.resolve()
        }
      },
      beta_testa2: {
        percentage: 100,
        condition: function () {
          return Promise.reject()
        }
      },
      beta_testa3: {
        percentage: 100,
        condition: function () {
          return false
        }
      }
    })

    return expect(subject.get('mixed_secret_feature', 123, {
      beta_testa: 'foo',
      beta_testa1: 'foo',
      beta_testa2: 'foo',
      beta_testa3: 'foo'
    })).to.be.fulfilled
  })

  it('rejects if all conditions fail', function () {
    subject.handler('mixed_secret_feature', {
      beta_testa1: {
        percentage: 0,
        condition: function () {
          return Promise.resolve()
        }
      },
      beta_testa2: {
        percentage: 100,
        condition: function () {
          return Promise.reject()
        }
      },
      beta_testa3: {
        percentage: 100,
        condition: function () {
          return false
        }
      }
    })

    return expect(subject.get('mixed_secret_feature', 123, {
      beta_testa1: 'foo',
      beta_testa2: 'foo',
      beta_testa3: 'foo'
    })).to.be.rejected
  })

  it('can retrieve all mod values', function (done) {
    subject.handler('super_secret', {
      foo: {
        percentage: 12
      },
      bar: {
        percentage: 34
      }
    })
    subject.on('ready', function () {
      subject.mods('super_secret').then(function (mods) {
        expect(mods).to.deep.equal({foo: '12', bar: '34'})
        done()
      })
    })
  })

  it('can retrieve all flagnames', function () {
    var o = {
      foo: {
        percentage: 100
      }
    }
    subject.handler('youza', o)
    subject.handler('huzzah', o)
    expect(subject.flags()).to.deep.equal(['youza', 'huzzah'])
  })

  it('gets multiple keys', function () {
    subject.handler('secret_feature', {
      employee: {
        percentage: 100,
        condition: function isCompanyEmail(val) {
          return val.match(/@expa\.com$/)
        }
      }
    })
    return subject.get('secret_feature', 123, {
      employee: 'ded@expa.com'
    })
    .then(function () {
      return subject.multi([['secret_feature', 123, {
        employee: 'ded@expa.com'
      }]])
      .then(function (result) {
        expect(result[0].isFulfilled()).to.be.true
      })
    })
  })

  context('not allowed percentage', function () {
    beforeEach(function () {
      sinon.stub(subject, 'val_to_percent')
    })
    afterEach(function () {
      subject.val_to_percent.restore()
    })

    it('rejects if not in allowed percentage', function () {
      subject.val_to_percent.returns(51.001)
      subject.handler('another_feature', {
        id: {
          percentage: 51.000
        }
      })
      var out = subject.get('another_feature', 123)
      return expect(out).to.be.rejected
    })
    it('should be able to update a key', function (done) {
      subject.val_to_percent.returns(50)
      subject.handler('button_test', {
        id: {
          percentage: 100
        }
      })
      v.waterfall(
        function (f) {
          subject.on('ready', function () {
            var out = subject.get('button_test', 123)
            expect(out).to.be.fulfilled
            f(null)
          })
        },
        function (f) {
          subject.update('button_test', {
            id: 49
          })
            .then(function () {
              var out = subject.get('button_test', 123)
              expect(out).to.be.rejected.notify(f)
            })
        },
        function (err) {
          done(err)
        }
      )
    })

    it('is optimistic', function (done) {
      subject.val_to_percent.returns(49)

      subject.handler('super_secret', {
        id: {
          // give feature to 49% of users
          percentage: 50
        },
        employee: {
          // give to 51% of employees
          percentage: 51,
          condition: function isCompanyEmail(val) {
            return val.match(/@expa\.com$/)
          }
        }
      })

      subject.on('ready', function () {
        var out = subject.get('super_secret', 123, {
          employee: 'regular@gmail.com'
        })
        // is rejected by company email, but falls within allowed regular users
        expect(out).to.be.fulfilled.notify(done)
      })
    })
  })
})
