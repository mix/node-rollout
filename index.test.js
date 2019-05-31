// Test imports
const chai = require('chai')
const sinon = require('sinon')
// Test setup
chai.use(require('sinon-chai'))
chai.use(require('chai-as-promised'))
const { expect } = chai
// Test subject imports
const Subject = require('./index')

const redisHashKey = 'REDIS_HASH_KEY'
const redisLegacyKeyPrefix = 'REDIS_LEGACY_KEY_PREFIX'

const invalidNames = ['', '=', ';', ',']

describe('node-rollout', function () {
  let redisClient
  let subject

  beforeEach(function () {
    redisClient = {
      hdel: sinon.stub(),
      hget: sinon.stub(),
      hgetall: sinon.stub(),
      hkeys: sinon.stub(),
      hset: sinon.stub(),
      mget: sinon.stub()
    }

    subject = new Subject({
      redisClient,
      redisHashKey,
      redisLegacyKeyPrefix
    })
  })

  describe('registerHandler', function () {
    describe('argument validation', function () {
      it('validates the handler name', function () {
        invalidNames.forEach(function (invalidName) {
          const promise = subject.registerHandler(invalidName, {
            'modifier1': { percentage: 100 }
          })
          expect(promise).to.eventually.be.rejected
        })
      })
      it('validates the modifiersConfig type', function () {
        const promise = subject.registerHandler('handler1', null)
        expect(promise).to.eventually.be.rejected
      })
      it('validates the modifiersConfig size', function () {
        const promise = subject.registerHandler('handler1', {})
        expect(promise).to.eventually.be.rejected
      })
      it('validates the modifiersConfig names', function () {
        invalidNames.forEach(function (invalidName) {
          const promise = subject.registerHandler('handler1', {
            [invalidName]: { percentage: 100 }
          })
          expect(promise).to.eventually.be.rejected
        })
      })
    })
    describe('cache handling', function () {
      it('optionally bypasses cached configuration in redis', function () {
        redisClient.hset.resolves()
        return subject.registerHandler('handler1', {
          'modifier1': { percentage: 100 }
        }, {
          resetCache: true
        })
        .then(function () {
          expect(redisClient.hget).to.not.have.been.called
          expect(redisClient.mget).to.not.have.been.called
          expect(redisClient.hset).to.have.been.calledOnce.and.calledWith(
            redisHashKey,
            'handler1',
            JSON.stringify({ 'modifier1': 100 })
          )
        })
      })
      it('looks up cached configuration in redis', function () {
        redisClient.hget.withArgs(redisHashKey, 'handler1').resolves(
          JSON.stringify({ 'modifier1': 50 })
        )
        redisClient.hset.resolves()
        return subject.registerHandler('handler1', {
          'modifier1': { percentage: 25 },
          'modifier2': { percentage: 75 }
        })
        .then(function () {
          expect(redisClient.hget).to.have.been.calledOnce
          expect(redisClient.mget).to.not.have.been.called
          expect(redisClient.hset).to.have.been.calledOnce.and.calledWith(
            redisHashKey,
            'handler1',
            JSON.stringify({ 'modifier1': 50, 'modifier2': 75 })
          )
        })
      })
      it('does not update unchanged cached configuration in redis', function () {
        redisClient.hget.withArgs(redisHashKey, 'handler1').resolves(
          JSON.stringify({ 'modifier1': 50, 'modifier2': 100 })
        )
        redisClient.hset.resolves()
        return subject.registerHandler('handler1', {
          'modifier1': { percentage: 25 },
          'modifier2': { percentage: 75 }
        })
        .then(function () {
          expect(redisClient.hget).to.have.been.calledOnce
          expect(redisClient.mget).to.not.have.been.called
          expect(redisClient.hset).to.not.have.been.called
        })
      })
      it('looks up the legacy modifier percentages', function () {
        redisClient.hget.withArgs(redisHashKey, 'handler1').resolves(null)
        redisClient.mget
        .withArgs(sinon.match([
          'REDIS_LEGACY_KEY_PREFIX:handler1:modifier1',
          'REDIS_LEGACY_KEY_PREFIX:handler1:modifier2'
        ]))
        .resolves(["50", null])
        redisClient.hset.resolves()
        return subject.registerHandler('handler1', {
          'modifier1': { percentage: 25 },
          'modifier2': { percentage: 100 }
        })
        .then(function () {
          expect(redisClient.hget).to.have.been.calledOnce
          expect(redisClient.mget).to.have.been.calledOnce
          expect(redisClient.hset).to.have.been.calledOnce.and.calledWith(
            redisHashKey,
            'handler1',
            JSON.stringify({ 'modifier1': 50, 'modifier2': 100 })
          )
        })
      })
    })
  })
})
