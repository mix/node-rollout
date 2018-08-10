var chai = require('chai')
  , sinon = require('sinon')
  , redis = require('redis').createClient()
  , Promise = require('bluebird')
  , promised = require('chai-as-promised')
  , rollout = require('../')
  , expect = chai.expect

chai.use(promised)
chai.use(require('sinon-chai'))

Promise.promisifyAll(redis)

function isCompanyEmail(val) {
  return /@company\.com$/.test(val)
}

describe('rollout', function () {
  var subject

  beforeEach(function () {
    subject = rollout(redis)
  })

  afterEach(function (done) {
    redis.flushdb(done)
  })

  it('fulfills', function () {
    return subject.handler('secret_feature', {
      employee: {
        percentage: 100,
        condition: isCompanyEmail
      }
    })
    .then(function () {
      var result = subject.get('secret_feature', 123, {
        employee: 'me@company.com'
      })
      return expect(result).to.be.fulfilled
    })
  })

  it('fulfills with applicable modifier for percentage', function () {
    return subject.handler('secret_feature', {
      everyone: {
        percentage: 0
      },
      employee: {
        percentage: 100,
        condition: isCompanyEmail
      }
    })
    .then(function () {
      var result = subject.get('secret_feature', 123, {
        employee: 'me@company.com'
      })
      return expect(result).to.eventually.equal('employee')
    })
  })

  context('percentage range', function () {
    beforeEach(function () {
      sinon.stub(subject, 'val_to_percent')
      return subject.handler('secret_feature', {
        groupA: {
          percentage: { min: 0, max: 25 }
        },
        groupB: {
          percentage: { min: 25, max: 50 }
        },
        groupC: {
          percentage: { min: 50, max: 100 }
        }
      })
    })
    afterEach(function () {
      subject.val_to_percent.restore()
    })

    it('fulfills with applicable modifier for range', function () {
      subject.val_to_percent.onCall(0).returns(37)
      var result = subject.get('secret_feature', 123)
      return expect(result).to.eventually.equal('groupB')
    })

    it('fulfills multiple with applicable modifiers for ranges', function () {
      subject.val_to_percent.onCall(0).returns(12)
      subject.val_to_percent.onCall(1).returns(49.97)
      subject.val_to_percent.onCall(2).returns(72)
      return subject.multi([
        ['secret_feature', 123],
        ['secret_feature', 321],
        ['secret_feature', 213]
      ])
      .then(function(results) {
        expect(results[0].isFulfilled()).to.be.true
        expect(results[0].value()).to.equal('groupA')
        expect(results[1].isFulfilled()).to.be.true
        expect(results[1].value()).to.equal('groupB')
        expect(results[2].isFulfilled()).to.be.true
        expect(results[2].value()).to.equal('groupC')
      })
    })
  })

  it('fulfills when condition returns a resolved promise', function () {
    return subject.handler('promise_secret_feature', {
      beta_testa: {
        percentage: 100,
        condition: function () {
          return new Promise(function (resolve) {
            setTimeout(resolve.bind(null, true), 10)
          })
        }
      }
    })
    .then(function () {
      var result = subject.get('promise_secret_feature', 123, {
        beta_testa: 'foo'
      })
      return expect(result).to.be.fulfilled
    })
  })

  it('rejects when condition returns a rejected promise', function () {
    return subject.handler('promise_secret_feature', {
      beta_testa: {
        percentage: 100,
        condition: function () {
          return Promise.reject()
        }
      }
    })
    .then(function () {
      var result = subject.get('promise_secret_feature', 123, {
        beta_testa: 'foo'
      })
      return expect(result).to.be.rejected
    })
  })

  it('fulfills if `any` condition passes', function () {
    return subject.handler('mixed_secret_feature', {
      beta_testa: {
        percentage: 100,
        condition: function () {
          return Promise.resolve(true)
        }
      },
      beta_testa1: {
        percentage: 0,
        condition: function () {
          return Promise.resolve(true)
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
    .then(function () {
      var result = subject.get('mixed_secret_feature', 123, {
        beta_testa: 'foo',
        beta_testa1: 'foo',
        beta_testa2: 'foo',
        beta_testa3: 'foo'
      })
      return expect(result).to.be.fulfilled
    })
  })

  it('rejects if all conditions fail', function () {
    return subject.handler('mixed_secret_feature', {
      beta_testa1: {
        percentage: 0,
        condition: function () {
          return Promise.resolve(true)
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
    .then(function () {
      var result = subject.get('mixed_secret_feature', 123, {
        beta_testa1: 'foo',
        beta_testa2: 'foo',
        beta_testa3: 'foo'
      })
      return expect(result).to.be.rejected
    })
  })

  it('can retrieve percentage mod values', function () {
    return subject.handler('super_secret', {
      foo: {
        percentage: 12
      },
      bar: {
        percentage: 34
      }
    })
    .then(function () {
      var result = subject.modifiers('super_secret')
      return expect(result).to.eventually.deep.equal({
        foo: 12,
        bar: 34
      })
    })
  })

  it('can retrieve range mod values', function () {
    return subject.handler('super_secret', {
      foo: {
        percentage: { min: 0, max: 50 }
      },
      bar: {
        percentage: { min: 50, max: 100 }
      }
    })
    .then(function () {
      var result = subject.modifiers('super_secret')
      return expect(result).to.eventually.deep.equal({
        foo: { min: 0, max: 50 },
        bar: { min: 50, max: 100 }
      })
    })
  })

  it('can retrieve all handler names', function () {
    var o = {
      foo: {
        percentage: 100
      }
    }
    return Promise.all([
      subject.handler('youza', o),
      subject.handler('huzzah', o)
    ])
    .then(function () {
      var result = subject.handlers()
      return expect(result).to.eventually.deep.equal(['youza', 'huzzah'])
    })
  })

  it('gets multiple keys', function () {
    return subject.handler('secret_feature', {
      employee: {
        percentage: 100,
        condition: isCompanyEmail
      }
    })
    .then(function () {
      return subject.multi([
        ['secret_feature', 123, { employee: 'me@company.com' }],
        ['secret_feature', 321, { employee: 'you@company.com' }],
        ['secret_feature', 231, { employee: 'someone@else.com' }]
      ])
      .then(function (result) {
        expect(result[0].isFulfilled()).to.be.true
        expect(result[0].value()).to.equal('employee')
        expect(result[1].isFulfilled()).to.be.true
        expect(result[1].value()).to.equal('employee')
        expect(result[2].isRejected()).to.be.true
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
      return subject.handler('another_feature', {
        id: {
          percentage: 51.000
        }
      })
      .then(function () {
        var result = subject.get('another_feature', 123)
        return expect(result).to.be.rejected
      })
    })

    it('should be able to update a key with a percentage', function () {
      subject.val_to_percent.returns(50)
      return subject.handler('button_test', {
        id: {
          percentage: 100
        }
      })
      .then(function() {
        var result = subject.get('button_test', 123)
        return expect(result).to.be.fulfilled
      })
      .then(function () {
        return subject.update('button_test', {
          id: 49
        })
        .then(function () {
          var result = subject.get('button_test', 123)
          return expect(result).to.be.rejected
        })
      })
    })

    it('should be able to update a key with a range', function () {
      subject.val_to_percent.returns(50)
      return subject.handler('experiment', {
        groupA: {
          percentage: 100
        },
        groupB: {
          percentage: 0
        }
      })
      .then(function() {
        var result = subject.get('experiment', 123)
        return expect(result).to.eventually.equal('groupA')
      })
      .then(function () {
        return subject.update('experiment', {
          groupA: { min: 0, max: 49 },
          groupB: { min: 49, max: 100 }
        })
        .then(function () {
          var result = subject.get('experiment', 123)
          return expect(result).to.eventually.equal('groupB')
        })
      })
    })

    it('is optimistic', function () {
      subject.val_to_percent.returns(49)
      return subject.handler('super_secret', {
        none: {
          percentage: 0
        },
        id: {
          // give feature to 49% of users
          percentage: 50
        },
        employee: {
          // give to 51% of employees
          percentage: 51,
          condition: isCompanyEmail
        }
      })
      .then(function () {
        var result = subject.get('super_secret', 123, {
          employee: 'regular@gmail.com'
        })
        // is rejected by company email, but falls within allowed regular users
        return expect(result).to.eventually.equal('id')
      })
    })
  })

  context('with a prefix option', function () {
    beforeEach(function () {
      subject = rollout(redis, { prefix: 'TEST_PREFIX' })
    })

    it('fulfills', function () {
      return subject.handler('secret_feature', {
        employee: {
          percentage: 100,
          condition: isCompanyEmail
        }
      })
      .then(function () {
        return redis.keysAsync('TEST_PREFIX:*')
      })
      .then(function (keys) {
        expect(keys).to.have.length(1)
        var result = subject.get('secret_feature', 123, {
          employee: 'me@company.com'
        })
        return expect(result).to.be.fulfilled
      })
    })
  })

  context('with a client factory', function () {
    beforeEach(function () {
      subject = rollout({
        clientFactory: function () {
          return redis
        }
      })
    })

    it('fulfills', function () {
      return subject.handler('secret_feature', {
        employee: {
          percentage: 100,
          condition: isCompanyEmail
        }
      })
      .then(function () {
        var result = subject.get('secret_feature', 123, {
          employee: 'me@company.com'
        })
        return expect(result).to.be.fulfilled
      })
    })
  })
})
