// Node imports
const crypto = require('crypto')
// Vendor imports
const _ = require('lodash')

// Type definitions
/**
 * @typedef {Object} RedisClient
 * @property {(key: string, fields: string[]) => Promise<number>} hdel
 * @property {(key: string, field: string) => Promise<string>} hget
 * @property {(key: string) => Promise<Object<string, string>>} hgetall
 * @property {(key: string) => Promise<string[]>} hkeys
 * @property {(key: string, field: string, value: string) => Promise<0|1>} hset
 * @property {(keys: string[]) => Promise<string[]>} mget
 * This assumes that you are using the `ioredis` library
 * @see https://github.com/luin/ioredis
 */
/**
 * @typedef {() => RedisClient} RedisClientFactory
 */
/**
 * @typedef {Object} PercentageRange
 * @property {number} min
 * @property {number} max
 */
/**
 * @typedef {number|PercentageRange} Percentage
 */
/**
 * @typedef {(credentials: Object) => Promise<boolean>} Condition
 */
/**
 * @typedef {Object} ModifierOptions
 * @property {Condition} [condition]
 * @property {Percentage} percentage
 */
/**
 * @typedef {Object<string, Percentage>} ModifierPercentages
 */
/**
 * @typedef {Object<string, ModifierOptions>} ModifiersConfig
 */
/**
 * @typedef {Object<string, ModifiersConfig>} HandlersConfig
 */

class Rollouts {
  /**
   * @constructor
   * @param {Object} [options]
   * @param {RedisClient} [options.redisClient]
   * @param {RedisClientFactory} [options.redisClientFactory]
   * @param {string} [options.redisHashKey]
   * @param {string} [options.redisLegacyKeyPrefix]
   */
  constructor(options = {}) {
    /** @type {HandlersConfig} */
    this.handlersConfig = {}
    // Extract options
    const { redisClient, redisClientFactory } = options
    if (!redisClient && !redisClientFactory) {
      throw new Error('`redisClient` or `redisClientFactory` option is required')
    }
    /** @type {RedisClientFactory} */
    this.getRedisClient = redisClientFactory || (() => redisClient)
    this.redisHashKey = options.redisHashKey
    this.redisLegacyKeyPrefix = options.redisLegacyKeyPrefix
    // Expose helper functions on class instance for middleware/rollouts
    this.likelihood = likelihood
    this.isValueInPercentageRange = isValueInPercentageRange
  }

  /**
   * @returns {Array<string>}
   * @public
   */
  getHandlerNames() {
    return Object.keys(this.handlersConfig)
  }

  /**
   * @param {string} handlerName
   * @returns {Array<string>}
   * @public
   */
  getModifierNames(handlerName) {
    return Object.keys(this.handlersConfig[handlerName])
  }

  /**
   * @param {string} handlerName
   * @returns {boolean}
   * @public
   */
  isRegisteredHandler(handlerName) {
    return handlerName in this.handlersConfig
  }

  /**
   * @param {string} handlerName
   * @param {string} modifierName
   * @returns {boolean}
   * @public
   */
  isRegisteredModifier(handlerName, modifierName) {
    return (
      this.isRegisteredHandler(handlerName) &&
      this.getModifierNames(handlerName).includes(modifierName)
    )
  }

  /**
   * @param {string} handlerName
   * @param {ModifiersConfig} modifiersConfig
   * @param {Object} [options]
   * @param {boolean} [options.resetCache]
   * @returns {Promise<void>}
   * @public
   */
  async registerHandler(handlerName, modifiersConfig, options = {}) {
    // Validate registration to prevent problematic names
    this.validateName(handlerName)
    this.validateModifiersConfig(modifiersConfig)
    // Assign the configuration if it passes validation
    this.handlersConfig[handlerName] = modifiersConfig

    const redisClient = this.getRedisClient()
    const modifierNames = Object.keys(modifiersConfig)

    /** @type {string} */
    let cachedValue
    /** @type {ModifierPercentages} */
    let cachedPercentages
    if (!options.resetCache) {
      cachedValue = await redisClient.hget(this.redisHashKey, handlerName)
      cachedPercentages = cachedValue
      ? JSON.parse(cachedValue)
      : await this.lookupLegacyModifierPercentages(handlerName)
    }

    const persistValue = JSON.stringify({
      ...modifiersConfigToPercentages(modifiersConfig),
      ..._.pick(cachedPercentages, modifierNames)
    })
    if (persistValue !== cachedValue) {
      await redisClient.hset(this.redisHashKey, handlerName, persistValue)
    }
  }

  /**
    * @param {string} handlerName
    * @returns {Promise<void>}
    * @public
    */
  async deleteHandler(handlerName) {
    const redisClient = this.getRedisClient()
    await redisClient.hdel(this.redisHashKey, [handlerName])
    delete this.handlersConfig[handlerName]
  }

  /**
   * @param {string} handlerName
   * @param {ModifierPercentages} modifierPercentages
   * @returns {Promise<void>}
   * @public
   */
  async updateHandler(handlerName, modifierPercentages) {
    const updatedValue = JSON.stringify({
      ...modifiersConfigToPercentages(await this.lookupHandler(handlerName)),
      ...normalizeModifierPercentages(modifierPercentages)
    })
    await this.getRedisClient().hset(this.redisHashKey, handlerName, updatedValue)
  }

  /**
   * Delete obsolete handlers from the redis cache
   * @returns {Promise<void>}
   * @public
   */
  async pruneObsoleteHandlersFromCache() {
    const redisClient = this.getRedisClient()
    const registeredHandlerNames = this.getHandlerNames()
    const cachedHandlerNames = await redisClient.hkeys(this.redisHashKey)
    const obsoleteHandlerNames = _.difference(cachedHandlerNames, registeredHandlerNames)
    if (obsoleteHandlerNames.length) {
      await redisClient.hdel(this.redisHashKey, obsoleteHandlerNames)
    }
  }

  /**
   * @param {number|string} userId
   * @param {Object} credentials
   * @returns {Promise<Object<string, string>>}
   * @public
   */
  async checkAllHandlers(userId, credentials) {
    const modifiersConfigByHandler = await this.lookupAllHandlers()
    const handlerNames = Object.keys(modifiersConfigByHandler)
    const promises = _.map(modifiersConfigByHandler, (modifiersConfig, handlerName) => {
      return this.checkHandlerModifiers(handlerName, modifiersConfig, userId, credentials)
    })
    return _.zipObject(handlerNames, await Promise.all(promises))
  }

  /**
   * @param {string} handlerName
   * @param {number|string} userId
   * @param {Object} credentials
   * @returns {Promise<string>}
   * @public
   */
  async checkHandler(handlerName, userId, credentials) {
    const modifiersConfig = await this.lookupHandler(handlerName)
    return this.checkHandlerModifiers(handlerName, modifiersConfig, userId, credentials)
  }

  /**
   * @returns {Promise<HandlersConfig>}
   * @private
   */
  async lookupAllHandlers() {
    const redisClient = this.getRedisClient()
    const hashObj = await redisClient.hgetall(this.redisHashKey)
    /** @type {HandlersConfig} */
    const handlersConfig = {}
    // Sort the handlers alphabetically for consistency
    for (let handlerName of this.getHandlerNames().sort()) {
      if (hashObj[handlerName]) {
        const modifierPercentages = JSON.parse(hashObj[handlerName])
        const modifiersConfig = this.modifierPercentagesToConfig(handlerName, modifierPercentages)
        handlersConfig[handlerName] = modifiersConfig
      } else {
        // Fall back to the configuration if the cache entry is missing
        handlersConfig[handlerName] = this.handlersConfig[handlerName]
      }
    }
    return handlersConfig
  }

  /**
   * @param {string} handlerName
   * @returns {Promise<ModifiersConfig>}
   * @private
   */
  async lookupHandler(handlerName) {
    const redisClient = this.getRedisClient()
    const cachedValue = await redisClient.hget(this.redisHashKey, handlerName)
    if (cachedValue) {
      return this.modifierPercentagesToConfig(handlerName, JSON.parse(cachedValue))
    }
    if (this.handlersConfig[handlerName]) {
      // Fall back to the configuration if the cache entry is missing
      return this.handlersConfig[handlerName]
    }
    throw new Error(`Rollouts handler not found: ${handlerName}`)
  }

  /**
   * @param {string} handlerName
   * @param {ModifiersConfig} modifiers
   * @param {number|string} userId
   * @param {Object} credentials
   * @returns {Promise<string>} First-applicable modifier for handler (or `undefined`)
   * @private
   */
  async checkHandlerModifiers(handlerName, modifiers, userId, credentials) {
    const likely = this.likelihood(handlerName + userId)
    /** @type {Array<boolean|Promise<boolean>>} */
    const deferredConditions = _.map(modifiers, modifierOptions => {
      if (isValueInPercentageRange(likely, modifierOptions.percentage)) {
        const modifierCondition = modifierOptions.condition || defaultCondition
        return modifierCondition(credentials)
      }
      return false
    })

    const modifierNames = Object.keys(modifiers)
    const resolvedConditions = await Promise.all(deferredConditions)
    for (let [ index, result ] of resolvedConditions.entries()) {
      if (result) {
        return modifierNames[index]
      }
    }
  }

  /**
   * @param {string} handlerName
   * @param {ModifierPercentages} modifierPercentages
   * @returns {ModifiersConfig}
   * @private
   */
  modifierPercentagesToConfig(handlerName, modifierPercentages) {
    const modifiersConfig = this.handlersConfig[handlerName]
    return mergeModifiersConfigWithPercentages(modifiersConfig, modifierPercentages)
  }

  /**
   * Throws an Error if the name is not valid
   * @param {string} name
   * @returns {void}
   * @throws If the name is not valid
   * @private
   */
  validateName(name) {
    if (!name || !_.isString(name)) {
      throw new Error('Name must be a non-empty string')
    }
    // Prevent characters that would break cookie parsing
    if (/[=;,]/.test(name)) {
      throw new Error('Name cannot include the following characters: = ; ,')
    }
  }

  /**
   * Throws an Error if the name is not valid
   * @param {ModifiersConfig} modifiersConfig
   * @returns {void}
   * @throws If `modifiersConfig` is not valid
   * @private
   */
  validateModifiersConfig(modifiersConfig) {
    if (!_.isPlainObject(modifiersConfig)) {
      throw new Error('Modifiers configuration must be a plain JavaScript Object')
    }
    if (_.isEmpty(modifiersConfig)) {
      throw new Error('Modifiers configuration must contain at least one modifier')
    }
    Object.keys(modifiersConfig).forEach(this.validateName)
  }

  /**
   * @param {string} handlerName
   * @returns {Promise<ModifierPercentages>}
   * @private
   */
  async lookupLegacyModifierPercentages(handlerName) {
    const redisClient = this.getRedisClient()
    const modifierNames = this.getModifierNames(handlerName)
    const configLegacyKeys = modifierNames.map(modifierName => {
      return this.getLegacyModifierKey(handlerName, modifierName)
    })
    const values = await redisClient.mget(configLegacyKeys)
    /** @type {ModifierPercentages} */
    const modifierPercentages = {}
    for (let [ index, value ] of values.entries()) {
      if (value) {
        const modifierName = modifierNames[index]
        modifierPercentages[modifierName] = JSON.parse(value)
      }
    }
    return modifierPercentages
  }

  /**
   * This is used for backwards-compatibility with existing (pre-2.0) configs
   * @param {string} handlerName
   * @param {string} modifierName
   * @returns {string}
   * @private
   */
  getLegacyModifierKey(handlerName, modifierName) {
    const prefix = this.redisLegacyKeyPrefix ? `${this.redisLegacyKeyPrefix}:` : ''
    return prefix + `${handlerName}:${modifierName}`
  }
}

module.exports = Rollouts

// Internal helper functions

async function defaultCondition() {
  return true
}

/**
 * Convert an abitrary string into a number between 0 and 100
 * @param {string} string
 * @returns {number}
 */
function likelihood(string) {
  const hashed = crypto.createHash('md5').update(string).digest('hex')
  const n = hashed.slice(0, hashed.length / 2)
  const m = n.replace(/./g, 'f')
  return parseInt(n, 16) / parseInt(m, 16) * 100
}

/**
 * @param {number} value
 * @param {Percentage} percentage
 * @returns {boolean}
 */
function isValueInPercentageRange(value, percentage) {
  if (_.isObject(percentage)) {
    return value > percentage.min && value <= percentage.max
  }
  return value < percentage
}

/**
 * Ensure that the number is a valid percentage (0-100)
 * @param {number} percentage
 * @returns {number}
 */
function clampPercentage(percentage) {
  return Math.max(0, Math.min(100, +(percentage || 0)))
}

/**
 * @param {Percentage} percentage
 * @returns {Percentage}
 */
function normalizePercentageRange(percentage) {
  if (_.isObject(percentage)) {
    return {
      min: clampPercentage(percentage.min),
      max: clampPercentage(percentage.max)
    }
  }
  return clampPercentage(percentage)
}

/**
 * @param {ModifierPercentages} modifierPercentages
 * @returns {ModifierPercentages}
 */
function normalizeModifierPercentages(modifierPercentages) {
  return _.transform(modifierPercentages, (acc, percentage, modifierName) => {
    acc[modifierName] = normalizePercentageRange(percentage)
  })
}

/**
 * @param {ModifiersConfig} modifiersConfig
 * @returns {ModifierPercentages}
 */
function modifiersConfigToPercentages(modifiersConfig) {
  return _.transform(modifiersConfig, (acc, modifierOptions, modifierName) => {
    acc[modifierName] = normalizePercentageRange(modifierOptions.percentage)
  })
}

/**
 * @param {ModifiersConfig} modifiersConfig
 * @param {ModifierPercentages} modifierPercentages
 * @returns {ModifiersConfig}
 */
function mergeModifiersConfigWithPercentages(modifiersConfig, modifierPercentages) {
  return _.transform(modifiersConfig, (acc, modifierOptions, modifierName) => {
    if (modifierName in modifierPercentages) {
      const percentage = modifierPercentages[modifierName]
      acc[modifierName] = { ...modifierOptions, percentage }
    } else {
      acc[modifierName] = modifierOptions
    }
  })
}
