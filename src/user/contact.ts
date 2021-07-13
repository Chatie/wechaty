/**
 *   Wechaty Chatbot SDK - https://github.com/wechaty/wechaty
 *
 *   @copyright 2016 Huan LI (李卓桓) <https://github.com/huan>, and
 *                   Wechaty Contributors <https://github.com/wechaty>.
 *
 *   Licensed under the Apache License, Version 2.0 (the "License");
 *   you may not use this file except in compliance with the License.
 *   You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 *   Unless required by applicable law or agreed to in writing, software
 *   distributed under the License is distributed on an "AS IS" BASIS,
 *   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *   See the License for the specific language governing permissions and
 *   limitations under the License.
 *
 */
import { instanceToClass }  from 'clone-class'

import {
  ContactGender,
  ContactPayload,
  ContactQueryFilter,
  ContactType,
  FileBox,
  PayloadType,
}                         from 'wechaty-puppet'

import { Wechaty }          from '../wechaty'

import {
  Raven,

  log,
  qrCodeForChatie,
  looseInstanceOfFileBox,
}                           from '../config'
import {
  Sayable,
}                           from '../types'

import { Message }      from './message'
import { MiniProgram }  from './mini-program'
import { Tag }          from './tag'
import { UrlLink }      from './url-link'

import { ContactEventEmitter }  from '../events/contact-events'

export const POOL = Symbol('pool')

/**
 * All wechat contacts(friend) will be encapsulated as a Contact.
 * [Examples/Contact-Bot]{@link https://github.com/wechaty/wechaty/blob/1523c5e02be46ebe2cc172a744b2fbe53351540e/examples/contact-bot.ts}
 *
 * @property {string}  id               - Get Contact id.
 * This function is depending on the Puppet Implementation, see [puppet-compatible-table](https://github.com/wechaty/wechaty/wiki/Puppet#3-puppet-compatible-table)
 */
class Contact extends ContactEventEmitter implements Sayable {

  static get wechaty  (): Wechaty { throw new Error('This class can not be used directly. See: https://github.com/wechaty/wechaty/issues/2027') }
  get wechaty        (): Wechaty { throw new Error('This class can not be used directly. See: https://github.com/wechaty/wechaty/issues/2027') }

  public static Type   = ContactType
  public static Gender = ContactGender

  protected static [POOL]: Map<string, Contact>
  protected static get pool () {
    return this[POOL]
  }

  protected static set pool (newPool: Map<string, Contact>) {
    if (this === Contact) {
      throw new Error(
        'The global Contact class can not be used directly!'
        + 'See: https://github.com/wechaty/wechaty/issues/1217',
      )
    }
    this[POOL] = newPool
  }

  /**
   * @ignore
   * About the Generic: https://stackoverflow.com/q/43003970/1123955
   *
   * Get Contact by id
   * > Tips:
   * This function is depending on the Puppet Implementation, see [puppet-compatible-table](https://github.com/wechaty/wechaty/wiki/Puppet#3-puppet-compatible-table)
   *
   * @static
   * @param {string} id
   * @returns {Contact}
   * @example
   * const bot = new Wechaty()
   * await bot.start()
   * const contact = bot.Contact.load('contactId')
   */
  public static load<T extends typeof Contact> (
    this : T,
    id   : string,
  ): T['prototype'] {
    if (!this.pool) {
      log.verbose('Contact', 'load(%s) init pool', id)
      this.pool = new Map<string, Contact>()
    }
    if (this === Contact) {
      throw new Error(
        'The global Contact class can not be used directly!'
        + 'See: https://github.com/wechaty/wechaty/issues/1217',
      )
    }
    if (this.pool === Contact.pool) {
      throw new Error('the current pool is equal to the global pool error!')
    }
    const existingContact = this.pool.get(id)
    if (existingContact) {
      return existingContact
    }

    // when we call `load()`, `this` should already be extend-ed a child class.
    // so we force `this as any` at here to make the call.
    const newContact = new (this as any)(id) as Contact

    this.pool.set(id, newContact)

    return newContact
  }

  /**
   * The way to search Contact
   *
   * @typedef    ContactQueryFilter
   * @property   {string} name    - The name-string set by user-self, should be called name
   * @property   {string} alias   - The name-string set by bot for others, should be called alias
   * [More Detail]{@link https://github.com/wechaty/wechaty/issues/365}
   */

  /**
   * Try to find a contact by filter: {name: string | RegExp} / {alias: string | RegExp}
   *
   * Find contact by name or alias, if the result more than one, return the first one.
   *
   * @static
   * @param {ContactQueryFilter} query
   * @returns {(Promise<Contact | null>)} If can find the contact, return Contact, or return null
   * @example
   * const bot = new Wechaty()
   * await bot.start()
   * const contactFindByName = await bot.Contact.find({ name:"ruirui"} )
   * const contactFindByAlias = await bot.Contact.find({ alias:"lijiarui"} )
   */
  public static async find<T extends typeof Contact> (
    this  : T,
    query : string | ContactQueryFilter,
  ): Promise<T['prototype'] | null> {
    log.verbose('Contact', 'find(%s)', JSON.stringify(query))

    const contactList = await this.findAll(query)

    if (!contactList) {
      return null
    }
    if (contactList.length < 1) {
      return null
    }

    if (contactList.length > 1) {
      log.warn('Contact', 'find() got more than one(%d) result', contactList.length)
    }

    let n = 0
    for (n = 0; n < contactList.length; n++) {
      const contact = contactList[n]!
      // use puppet.contactValidate() to confirm double confirm that this contactId is valid.
      // https://github.com/wechaty/wechaty-puppet-padchat/issues/64
      // https://github.com/wechaty/wechaty/issues/1345
      const valid = await this.wechaty.puppet.contactValidate(contact.id)
      if (valid) {
        log.verbose('Contact', 'find() confirm contact[#%d] with id=%d is valid result, return it.',
          n,
          contact.id,
        )
        return contact
      } else {
        log.verbose('Contact', 'find() confirm contact[#%d] with id=%d is INVALID result, try next',
          n,
          contact.id,
        )
      }
    }
    log.warn('Contact', 'find() got %d contacts but no one is valid.', contactList.length)
    return null
  }

  /**
   * Find contact by `name` or `alias`
   *
   * If use Contact.findAll() get the contact list of the bot.
   *
   * #### definition
   * - `name`   the name-string set by user-self, should be called name
   * - `alias`  the name-string set by bot for others, should be called alias
   *
   * @static
   * @param {ContactQueryFilter} [queryArg]
   * @returns {Promise<Contact[]>}
   * @example
   * const bot = new Wechaty()
   * await bot.start()
   * const contactList = await bot.Contact.findAll()                      // get the contact list of the bot
   * const contactList = await bot.Contact.findAll({ name: 'ruirui' })    // find all of the contacts whose name is 'ruirui'
   * const contactList = await bot.Contact.findAll({ alias: 'lijiarui' }) // find all of the contacts whose alias is 'lijiarui'
   */
  public static async findAll<T extends typeof Contact> (
    this  : T,
    query? : string | ContactQueryFilter,
  ): Promise<Array<T['prototype']>> {
    log.verbose('Contact', 'findAll(%s)', JSON.stringify(query) || '')

    try {
      const contactIdList: string[] = await this.wechaty.puppet.contactSearch(query)
      const contactList = contactIdList.map(id => this.load(id))

      const BATCH_SIZE = 16
      let   batchIndex = 0

      const invalidDict: { [id: string]: true } = {}

      while (batchIndex * BATCH_SIZE < contactList.length) {
        const batchContactList = contactList.slice(
          BATCH_SIZE * batchIndex,
          BATCH_SIZE * (batchIndex + 1),
        )
        await Promise.all(
          batchContactList.map(
            c => c.ready()
              .catch(e => {
                log.error('Contact', 'findAll() contact.ready() exception: %s', e.message)
                invalidDict[c.id] = true
              }),
          ),
        )

        batchIndex++
      }

      return contactList.filter(contact => !invalidDict[contact.id])

    } catch (e) {
      log.error('Contact', 'this.wechaty.puppet.contactFindAll() rejected: %s', e.message)
      return [] // fail safe
    }
  }

  // TODO
  public static async delete (contact: Contact): Promise<void> {
    log.verbose('Contact', 'static delete(%s)', contact.id)
  }

  /**
   * Get tags for all contact
   *
   * @static
   * @returns {Promise<Tag[]>}
   * @example
   * const tags = await wechaty.Contact.tags()
   */
  public static async tags (): Promise<Tag []> {
    log.verbose('Contact', 'static tags() for %s', this)

    try {
      const tagIdList = await this.wechaty.puppet.tagContactList()
      const tagList = tagIdList.map(id => this.wechaty.Tag.load(id))
      return tagList
    } catch (e) {
      log.error('Contact', 'static tags() exception: %s', e.message)
      return []
    }
  }

  /**
   *
   * Instance properties
   * @ignore
   *
   */
  protected payload?: ContactPayload

  /**
   * @hideconstructor
   */
  protected constructor (
    public readonly id: string,
  ) {
    super()
    log.silly('Contact', `constructor(${id})`)

    const MyClass = instanceToClass(this, Contact)

    if (MyClass === Contact) {
      throw new Error(
        'Contact class can not be instantiated directly!'
        + 'See: https://github.com/wechaty/wechaty/issues/1217',
      )
    }

    if (!this.wechaty) {
      throw new Error('Contact class can not be instantiated without a wechaty instance!')
    }
  }

  /**
   * @ignore
   */
  public override toString (): string {
    if (!this.payload) {
      return this.constructor.name
    }

    const identity = this.payload.alias
                    || this.payload.name
                    || this.id
                    || 'loading...'

    return `Contact<${identity}>`
  }

  public say (text:     string)      : Promise<void | Message>
  public say (num:      number)      : Promise<void | Message>
  public say (message:  Message)     : Promise<void | Message>
  public say (contact:  Contact)     : Promise<void | Message>
  public say (file:     FileBox)     : Promise<void | Message>
  public say (mini:     MiniProgram) : Promise<void | Message>
  public say (url:      UrlLink)     : Promise<void | Message>

  /**
   * > Tips:
   * This function is depending on the Puppet Implementation, see [puppet-compatible-table](https://github.com/wechaty/wechaty/wiki/Puppet#3-puppet-compatible-table)
   *
   * @param {(string | Contact | FileBox | UrlLink | MiniProgram)} something
   * send text, Contact, or file to contact. </br>
   * You can use {@link https://www.npmjs.com/package/file-box|FileBox} to send file
   * @returns {Promise<void | Message>}
   * @example
   * const bot = new Wechaty()
   * await bot.start()
   * const contact = await bot.Contact.find({name: 'lijiarui'})  // change 'lijiarui' to any of your contact name in wechat
   *
   * // 1. send text to contact
   *
   * await contact.say('welcome to wechaty!')
   * const msg = await contact.say('welcome to wechaty!') // only supported by puppet-padplus
   *
   * // 2. send media file to contact
   *
   * import { FileBox }  from 'wechaty'
   * const fileBox1 = FileBox.fromUrl('https://wechaty.github.io/wechaty/images/bot-qr-code.png')
   * const fileBox2 = FileBox.fromFile('/tmp/text.txt')
   * await contact.say(fileBox1)
   * const msg1 = await contact.say(fileBox1) // only supported by puppet-padplus
   * await contact.say(fileBox2)
   * const msg2 = await contact.say(fileBox2) // only supported by puppet-padplus
   *
   * // 3. send contact card to contact
   *
   * const contactCard = bot.Contact.load('contactId')
   * const msg = await contact.say(contactCard) // only supported by puppet-padplus
   *
   * // 4. send url link to contact
   *
   * const urlLink = new UrlLink ({
   *   description : 'WeChat Bot SDK for Individual Account, Powered by TypeScript, Docker, and Love',
   *   thumbnailUrl: 'https://avatars0.githubusercontent.com/u/25162437?s=200&v=4',
   *   title       : 'Welcome to Wechaty',
   *   url         : 'https://github.com/wechaty/wechaty',
   * })
   * await contact.say(urlLink)
   * const msg = await contact.say(urlLink) // only supported by puppet-padplus
   *
   * // 5. send mini program to contact
   *
   * const miniProgram = new MiniProgram ({
   *   username           : 'gh_xxxxxxx',     //get from mp.weixin.qq.com
   *   appid              : '',               //optional, get from mp.weixin.qq.com
   *   title              : '',               //optional
   *   pagepath           : '',               //optional
   *   description        : '',               //optional
   *   thumbnailurl       : '',               //optional
   * })
   * await contact.say(miniProgram)
   * const msg = await contact.say(miniProgram) // only supported by puppet-padplus
   */
  public async say (
    something:  string
              | number
              | Message
              | Contact
              | FileBox
              | MiniProgram
              | UrlLink
  ): Promise<void | Message> {
    log.verbose('Contact', 'say(%s)', something)

    if (something instanceof Message) {
      return something.forward(this)
    }

    if (typeof something === 'number') {
      something = String(something)
    }

    let msgId: string | void
    if (typeof something === 'string') {
      /**
       * 1. Text
       */
      msgId = await this.wechaty.puppet.messageSendText(
        this.id,
        something,
      )
    } else if (something instanceof Contact) {
      /**
       * 2. Contact
       */
      msgId = await this.wechaty.puppet.messageSendContact(
        this.id,
        something.id,
      )
    } else if (looseInstanceOfFileBox(something)) {
      /**
       * 3. File
       */
      msgId = await this.wechaty.puppet.messageSendFile(
        this.id,
        something,
      )
    } else if (something instanceof UrlLink) {
      /**
       * 4. Link Message
       */
      msgId = await this.wechaty.puppet.messageSendUrl(
        this.id,
        something.payload,
      )
    } else if (something instanceof MiniProgram) {
      /**
       * 5. Mini Program
       */
      msgId = await this.wechaty.puppet.messageSendMiniProgram(
        this.id,
        something.payload,
      )
    } else {
      throw new Error('unsupported arg: ' + something)
    }
    if (msgId) {
      const msg = this.wechaty.Message.load(msgId)
      await msg.ready()
      return msg
    }
  }

  /**
   * Get the name from a contact
   *
   * @returns {string}
   * @example
   * const name = contact.name()
   */
  public name (): string {
    return (this.payload && this.payload.name) || ''
  }

  public async alias ()                  : Promise<null | string>
  public async alias (newAlias:  string) : Promise<void>
  public async alias (empty:     null)   : Promise<void>

  /**
   * GET / SET / DELETE the alias for a contact
   *
   * Tests show it will failed if set alias too frequently(60 times in one minute).
   * @param {(none | string | null)} newAlias
   * @returns {(Promise<null | string | void>)}
   * @example <caption> GET the alias for a contact, return {(Promise<string | null>)}</caption>
   * const alias = await contact.alias()
   * if (alias === null) {
   *   console.log('You have not yet set any alias for contact ' + contact.name())
   * } else {
   *   console.log('You have already set an alias for contact ' + contact.name() + ':' + alias)
   * }
   *
   * @example <caption>SET the alias for a contact</caption>
   * try {
   *   await contact.alias('lijiarui')
   *   console.log(`change ${contact.name()}'s alias successfully!`)
   * } catch (e) {
   *   console.log(`failed to change ${contact.name()} alias!`)
   * }
   *
   * @example <caption>DELETE the alias for a contact</caption>
   * try {
   *   const oldAlias = await contact.alias(null)
   *   console.log(`delete ${contact.name()}'s alias successfully!`)
   *   console.log('old alias is ${oldAlias}`)
   * } catch (e) {
   *   console.log(`failed to delete ${contact.name()}'s alias!`)
   * }
   */
  public async alias (newAlias?: null | string): Promise<null | string | void> {
    log.silly('Contact', 'alias(%s)',
      newAlias === undefined
        ? ''
        : newAlias,
    )

    if (!this.payload) {
      throw new Error('no payload')
    }

    if (typeof newAlias === 'undefined') {
      return this.payload.alias || null
    }

    try {
      await this.wechaty.puppet.contactAlias(this.id, newAlias)
      await this.wechaty.puppet.dirtyPayload(PayloadType.Contact, this.id)
      this.payload = await this.wechaty.puppet.contactPayload(this.id)
      if (newAlias && newAlias !== this.payload.alias) {
        log.warn('Contact', 'alias(%s) sync with server fail: set(%s) is not equal to get(%s)',
          newAlias,
          newAlias,
          this.payload.alias,
        )
      }
    } catch (e) {
      log.error('Contact', 'alias(%s) rejected: %s', newAlias, e.message)
      Raven.captureException(e)
    }
  }

  /**
   * GET / SET / DELETE the phone list for a contact
   *
   * @param {(none | string[])} phoneList
   * @returns {(Promise<string[] | void>)}
   * @example <caption> GET the phone list for a contact, return {(Promise<string[]>)}</caption>
   * const phoneList = await contact.phone()
   * if (phone.length === 0) {
   *   console.log('You have not yet set any phone number for contact ' + contact.name())
   * } else {
   *   console.log('You have already set phone numbers for contact ' + contact.name() + ':' + phoneList.join(','))
   * }
   *
   * @example <caption>SET the phoneList for a contact</caption>
   * try {
   *   const phoneList = ['13999999999', '13888888888']
   *   await contact.alias(phoneList)
   *   console.log(`change ${contact.name()}'s phone successfully!`)
   * } catch (e) {
   *   console.log(`failed to change ${contact.name()} phone!`)
   * }
   */
  public async phone (): Promise<string[]>
  public async phone (phoneList: string[]): Promise<void>
  public async phone (phoneList?: string[]): Promise<string[] | void> {
    log.silly('Contact', 'phone(%s)', phoneList === undefined ? '' : JSON.stringify(phoneList))

    if (!this.payload) {
      throw new Error('no payload')
    }

    if (typeof phoneList === 'undefined') {
      return this.payload.phone
    }

    try {
      await this.wechaty.puppet.contactPhone(this.id, phoneList)
      await this.wechaty.puppet.dirtyPayload(PayloadType.Contact, this.id)
      this.payload = await this.wechaty.puppet.contactPayload(this.id)
    } catch (e) {
      log.error('Contact', 'phone(%s) rejected: %s', JSON.stringify(phoneList), e.message)
      Raven.captureException(e)
    }
  }

  public async corporation (): Promise<string | null>
  public async corporation (remark: string | null): Promise<void>
  public async corporation (remark?: string | null): Promise<string | null | void> {
    log.silly('Contact', 'corporation(%s)', remark)

    if (!this.payload) {
      throw new Error('no payload')
    }

    if (typeof remark === 'undefined') {
      return this.payload.corporation || null
    }

    if (this.payload.type !== ContactType.Individual) {
      throw new Error('Can not set corporation remark on non individual contact.')
    }

    try {
      await this.wechaty.puppet.contactCorporationRemark(this.id, remark)
      await this.wechaty.puppet.dirtyPayload(PayloadType.Contact, this.id)
      this.payload = await this.wechaty.puppet.contactPayload(this.id)
    } catch (e) {
      log.error('Contact', 'corporation(%s) rejected: %s', remark, e.message)
      Raven.captureException(e)
    }
  }

  public async description (): Promise<string | null>
  public async description (newDescription: string | null): Promise<void>
  public async description (newDescription?: string | null): Promise<string | null | void> {
    log.silly('Contact', 'description(%s)', newDescription)

    if (!this.payload) {
      throw new Error('no payload')
    }

    if (typeof newDescription === 'undefined') {
      return this.payload.description || null
    }

    try {
      await this.wechaty.puppet.contactDescription(this.id, newDescription)
      await this.wechaty.puppet.dirtyPayload(PayloadType.Contact, this.id)
      this.payload = await this.wechaty.puppet.contactPayload(this.id)
    } catch (e) {
      log.error('Contact', 'description(%s) rejected: %s', newDescription, e.message)
      Raven.captureException(e)
    }
  }

  public title (): string | null {
    if (!this.payload) {
      throw new Error('no payload')
    }

    return this.payload.title || null
  }

  public coworker (): boolean {
    if (!this.payload) {
      throw new Error('no payload')
    }

    return !!this.payload.coworker
  }

  /**
   * Check if contact is friend
   *
   * > Tips:
   * This function is depending on the Puppet Implementation, see [puppet-compatible-table](https://github.com/wechaty/wechaty/wiki/Puppet#3-puppet-compatible-table)
   *
   * @returns {boolean | null}
   *
   * <br>True for friend of the bot <br>
   * False for not friend of the bot, null for unknown.
   * @example
   * const isFriend = contact.friend()
   */
  public friend (): null | boolean {
    log.verbose('Contact', 'friend()')
    if (!this.payload) {
      return null
    }
    if (typeof this.payload.friend === 'boolean') {
      return this.payload.friend
    } else {
      return null
    }
  }

  /**
   * Enum for ContactType
   * @enum {number}
   * @property {number} Unknown    - ContactType.Unknown    (0) for Unknown
   * @property {number} Personal   - ContactType.Personal   (1) for Personal
   * @property {number} Official   - ContactType.Official   (2) for Official
   */

  /**
   * Return the type of the Contact
   * > Tips: ContactType is enum here.</br>
   * @returns {ContactType.Unknown | ContactType.Personal | ContactType.Official}
   *
   * @example
   * const bot = new Wechaty()
   * await bot.start()
   * const isOfficial = contact.type() === bot.Contact.Type.Official
   */
  public type (): ContactType {
    if (!this.payload) {
      throw new Error('no payload')
    }
    return this.payload.type
  }

  /**
   * @ignore
   * TODO
   * Check if the contact is star contact.
   *
   * @returns {boolean | null} - True for star friend, False for no star friend.
   * @example
   * const isStar = contact.star()
   */
  public star (): null | boolean {
    if (!this.payload) {
      return null
    }
    return this.payload.star === undefined
      ? null
      : this.payload.star
  }

  /**
   * Contact gender
   * > Tips: ContactGender is enum here. </br>
   *
   * @returns {ContactGender.Unknown | ContactGender.Male | ContactGender.Female}
   * @example
   * const gender = contact.gender() === bot.Contact.Gender.Male
   */
  public gender (): ContactGender {
    return this.payload
      ? this.payload.gender
      : ContactGender.Unknown
  }

  /**
   * Get the region 'province' from a contact
   *
   * @returns {string | null}
   * @example
   * const province = contact.province()
   */
  public province (): null | string {
    return (this.payload && this.payload.province) || null
  }

  /**
   * Get the region 'city' from a contact
   *
   * @returns {string | null}
   * @example
   * const city = contact.city()
   */
  public city (): null | string {
    return (this.payload && this.payload.city) || null
  }

  /**
   * Get avatar picture file stream
   *
   * @returns {Promise<FileBox>}
   * @example
   * // Save avatar to local file like `1-name.jpg`
   *
   * const file = await contact.avatar()
   * const name = file.name
   * await file.toFile(name, true)
   * console.log(`Contact: ${contact.name()} with avatar file: ${name}`)
   */
  public async avatar (): Promise<FileBox> {
    log.verbose('Contact', 'avatar()')

    try {
      const fileBox = await this.wechaty.puppet.contactAvatar(this.id)
      return fileBox
    } catch (e) {
      log.error('Contact', 'avatar() exception: %s', e.message)
      return qrCodeForChatie()
    }
  }

  /**
   * Get all tags of contact
   *
   * @returns {Promise<Tag[]>}
   * @example
   * const tags = await contact.tags()
   */
  public async tags (): Promise<Tag []> {
    log.verbose('Contact', 'tags() for %s', this)

    try {
      const tagIdList = await this.wechaty.puppet.tagContactList(this.id)
      const tagList = tagIdList.map(id => this.wechaty.Tag.load(id))
      return tagList
    } catch (e) {
      log.error('Contact', 'tags() exception: %s', e.message)
      return []
    }
  }

  /**
   * Force reload data for Contact, Sync data from low-level API again.
   *
   * @returns {Promise<this>}
   * @example
   * await contact.sync()
   */
  public async sync (): Promise<void> {
    await this.ready(true)
  }

  /**
   * `ready()` is For FrameWork ONLY!
   *
   * Please not to use `ready()` at the user land.
   * If you want to sync data, use `sync()` instead.
   *
   * @ignore
   */
  public async ready (
    forceSync = false,
  ): Promise<void> {
    log.silly('Contact', 'ready() @ %s with id="%s"', this.wechaty.puppet, this.id)

    if (!forceSync && this.isReady()) { // already ready
      log.silly('Contact', 'ready() isReady() true')
      return
    }

    try {
      if (forceSync) {
        await this.wechaty.puppet.dirtyPayload(PayloadType.Contact, this.id)
      }
      this.payload = await this.wechaty.puppet.contactPayload(this.id)
      // log.silly('Contact', `ready() this.wechaty.puppet.contactPayload(%s) resolved`, this)

    } catch (e) {
      log.verbose('Contact', 'ready() this.wechaty.puppet.contactPayload(%s) exception: %s',
        this.id,
        e.message,
      )
      Raven.captureException(e)
      throw e
    }
  }

  /**
   * Mark the conversation as read
   * @param {boolean} hasRead
   *
   * @example
   * const bot = new Wechaty()
   * const contact = await bot.Contact.find({name: 'xxx'})
   * await contact.readMark()
   */
  public async readMark (hasRead?: boolean): Promise<void | boolean> {
    try {
      return this.wechaty.puppet.conversationReadMark(this.id, hasRead)
    } catch (e) {
      log.error('Contact', 'readMark() exception: %s', e.message)
    }
  }

  /**
   * @ignore
   */
  public isReady (): boolean {
    return !!(this.payload && this.payload.name)
  }

  /**
   * Check if contact is self
   *
   * @returns {boolean} True for contact is self, False for contact is others
   * @example
   * const isSelf = contact.self()
   */
  public self (): boolean {
    const userId = this.wechaty.puppet.selfId()

    if (!userId) {
      return false
    }

    return this.id === userId
  }

  /**
   * Get the weixin number from a contact.
   *
   * Sometimes cannot get weixin number due to weixin security mechanism, not recommend.
   *
   * @ignore
   * @returns {string | null}
   * @example
   * const weixin = contact.weixin()
   */
  public weixin (): null | string {
    return (this.payload && this.payload.weixin) || null
  }

}

function wechatifyContact (wechaty: Wechaty): typeof Contact {

  class WechatifiedContact extends Contact {

    static override get wechaty  () { return wechaty }
    override get wechaty        () { return wechaty }

  }

  return WechatifiedContact

}

export {
  Contact,
  wechatifyContact,
}
