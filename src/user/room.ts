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
import { instanceToClass } from 'clone-class'

import { Wechaty }          from '../wechaty'

import {
  FOUR_PER_EM_SPACE,
  FileBox,

  log,
  Raven,
  looseInstanceOfFileBox,
}                           from '../config'
import {
  Sayable,
}                           from '../types'

import {
  guardQrCodeValue,
}                       from '../helper-functions/pure/guard-qr-code-value'

import { Contact }        from './contact'
import { MiniProgram }    from './mini-program'
import { Message }        from './message'
import { UrlLink }        from './url-link'

import {
  RoomMemberQueryFilter,
  RoomPayload,
  RoomQueryFilter,
  PayloadType,
}                         from 'wechaty-puppet'

import { RoomEventEmitter } from '../events/room-events'

/**
 * All WeChat rooms(groups) will be encapsulated as a Room.
 *
 * [Examples/Room-Bot]{@link https://github.com/wechaty/wechaty/blob/1523c5e02be46ebe2cc172a744b2fbe53351540e/examples/room-bot.ts}
 *
 */
class Room extends RoomEventEmitter implements Sayable {

  static get wechaty  (): Wechaty { throw new Error('This class can not be used directly. See: https://github.com/wechaty/wechaty/issues/2027') }
  get wechaty        (): Wechaty { throw new Error('This class can not be used directly. See: https://github.com/wechaty/wechaty/issues/2027') }

  protected static pool: Map<string, Room>

  /**
   * Create a new room.
   *
   * @static
   * @param {Contact[]} contactList
   * @param {string} [topic]
   * @returns {Promise<Room>}
   * @example <caption>Creat a room with 'lijiarui' and 'huan', the room topic is 'ding - created'</caption>
   * const helperContactA = await Contact.find({ name: 'lijiarui' })  // change 'lijiarui' to any contact in your WeChat
   * const helperContactB = await Contact.find({ name: 'huan' })  // change 'huan' to any contact in your WeChat
   * const contactList = [helperContactA, helperContactB]
   * console.log('Bot', 'contactList: %s', contactList.join(','))
   * const room = await Room.create(contactList, 'ding')
   * console.log('Bot', 'createDingRoom() new ding room created: %s', room)
   * await room.topic('ding - created')
   * await room.say('ding - created')
   */
  public static async create (contactList: Contact[], topic?: string): Promise<Room> {
    log.verbose('Room', 'create(%s, %s)', contactList.join(','), topic)

    if (!contactList
      || !Array.isArray(contactList)
    ) {
      throw new Error('contactList not found')
    }

    if (contactList.length < 2) {
      throw new Error('contactList need at least 2 contact to create a new room')
    }

    try {
      const contactIdList = contactList.map(contact => contact.id)
      const roomId = await this.wechaty.puppet.roomCreate(contactIdList, topic)
      const room = this.load(roomId)
      return room
    } catch (e) {
      log.error('Room', 'create() exception: %s', (e && e.stack) || e.message || e)
      Raven.captureException(e)
      throw e
    }
  }

  /**
   * The filter to find the room:  {topic: string | RegExp}
   *
   * @typedef    RoomQueryFilter
   * @property   {string} topic
   */

  /**
   * Find room by by filter: {topic: string | RegExp}, return all the matched room
   * @static
   * @param {RoomQueryFilter} [query]
   * @returns {Promise<Room[]>}
   * @example
   * const bot = new Wechaty()
   * await bot.start()
   * // after logged in
   * const roomList = await bot.Room.findAll()                    // get the room list of the bot
   * const roomList = await bot.Room.findAll({topic: 'wechaty'})  // find all of the rooms with name 'wechaty'
   */
  public static async findAll<T extends typeof Room> (
    this   : T,
    query? : RoomQueryFilter,
  ): Promise<Array<T['prototype']>> {
    log.verbose('Room', 'findAll(%s)', JSON.stringify(query) || '')

    try {
      const roomIdList = await this.wechaty.puppet.roomSearch(query)
      const roomList = roomIdList.map(id => this.load(id))

      const BATCH_SIZE = 10
      let   batchIndex = 0

      const invalidSet: Set<string> = new Set()
      while (batchIndex * BATCH_SIZE < roomList.length) {
        const batchRoomList = roomList.slice(
          BATCH_SIZE * batchIndex,
          BATCH_SIZE * (batchIndex + 1),
        )

        await Promise.all(
          batchRoomList.map(
            room => room.ready()
              .catch(e => {
                log.warn('Room', 'findAll() room.ready() rejection:\n%s', e.stack)
                invalidSet.add(room.id)
              })
          ),
        )

        batchIndex++
      }

      return roomList.filter(room => !invalidSet.has(room.id))

    } catch (e) {
      log.verbose('Room', 'findAll() rejected: %s', e.message)
      console.error(e)
      Raven.captureException(e)
      return [] as Room[] // fail safe
    }
  }

  /**
   * Try to find a room by filter: {topic: string | RegExp}. If get many, return the first one.
   *
   * @param {RoomQueryFilter} query
   * @returns {Promise<Room | null>} If can find the room, return Room, or return null
   * @example
   * const bot = new Wechaty()
   * await bot.start()
   * // after logged in...
   * const roomList = await bot.Room.find()
   * const roomList = await bot.Room.find({topic: 'wechaty'})
   */

  public static async find<T extends typeof Room> (
    this  : T,
    query : string | RoomQueryFilter,
  ): Promise<T['prototype'] | null> {
    log.verbose('Room', 'find(%s)', JSON.stringify(query))

    if (typeof query === 'string') {
      query = { topic: query }
    }

    const roomList = await this.findAll(query)
    if (!roomList) {
      return null
    }
    if (roomList.length < 1) {
      return null
    }

    if (roomList.length > 1) {
      log.warn('Room', 'find() got more than one(%d) result', roomList.length)
    }

    let n = 0
    for (n = 0; n < roomList.length; n++) {
      const room = roomList[n]!
      // use puppet.roomValidate() to confirm double confirm that this roomId is valid.
      // https://github.com/wechaty/wechaty-puppet-padchat/issues/64
      // https://github.com/wechaty/wechaty/issues/1345
      const valid = await this.wechaty.puppet.roomValidate(room.id)
      if (valid) {
        log.verbose('Room', 'find() confirm room[#%d] with id=%d is valid result, return it.',
          n,
          room.id,
        )
        return room
      } else {
        log.verbose('Room', 'find() confirm room[#%d] with id=%d is INVALID result, try next',
          n,
          room.id,
        )
      }
    }
    log.warn('Room', 'find() got %d rooms but no one is valid.', roomList.length)
    return null
  }

  /**
   * @ignore
   * About the Generic: https://stackoverflow.com/q/43003970/1123955
   *
   * Load room by topic. <br>
   * > Tips: For Web solution, it cannot get the unique topic id,
   * but for other solutions besides web,
   * we can get unique and permanent topic id.
   *
   * This function is depending on the Puppet Implementation, see [puppet-compatible-table](https://github.com/wechaty/wechaty/wiki/Puppet#3-puppet-compatible-table)
   * @static
   * @param {string} id
   * @returns {Room}
   * @example
   * const bot = new Wechaty()
   * await bot.start()
   * // after logged in...
   * const room = bot.Room.load('roomId')
   */
  public static load<T extends typeof Room> (
    this : T,
    id   : string,
  ): T['prototype'] {
    if (!this.pool) {
      this.pool = new Map<string, Room>()
    }

    const existingRoom = this.pool.get(id)
    if (existingRoom) {
      return existingRoom
    }

    const newRoom = new (this as any)(id) as Room

    this.pool.set(id, newRoom)
    return newRoom
  }

  /**
   * @ignore
   *
   * Instance Properties
   *
   *
   */
  protected payload?: RoomPayload

  /**
   * @hideconstructor
   * @property {string}  id - Room id.
   * This function is depending on the Puppet Implementation, see [puppet-compatible-table](https://github.com/wechaty/wechaty/wiki/Puppet#3-puppet-compatible-table)
   */
  protected constructor (
    public readonly id: string,
  ) {
    super()
    log.silly('Room', `constructor(${id})`)

    const MyClass = instanceToClass(this, Room)

    if (MyClass === Room) {
      throw new Error('Room class can not be instantiated directly! See: https://github.com/wechaty/wechaty/issues/1217')
    }

    if (!this.wechaty.puppet) {
      throw new Error('Room class can not be instantiated without a puppet!')
    }

  }

  /**
   * @ignore
   */
  public override toString () {
    if (!this.payload) {
      return this.constructor.name
    }

    return `Room<${this.payload.topic || 'loading...'}>`
  }

  public async * [Symbol.asyncIterator] (): AsyncIterableIterator<Contact> {
    const memberList = await this.memberList()
    for (const contact of memberList) {
      yield contact
    }
  }

  /**
   * Force reload data for Room, Sync data from puppet API again.
   *
   * @returns {Promise<void>}
   * @example
   * await room.sync()
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
    log.verbose('Room', 'ready()')

    if (!forceSync && this.isReady()) {
      return
    }

    if (forceSync) {
      await this.wechaty.puppet.dirtyPayload(PayloadType.Room, this.id)
      await this.wechaty.puppet.dirtyPayload(PayloadType.RoomMember, this.id)
    }
    this.payload = await this.wechaty.puppet.roomPayload(this.id)

    if (!this.payload) {
      throw new Error('ready() no payload')
    }

    const memberIdList = await this.wechaty.puppet.roomMemberList(this.id)

    const memberList = memberIdList.map(id => this.wechaty.Contact.load(id))

    const BATCH_SIZE = 16
    let   batchIndex = 0

    while (batchIndex * BATCH_SIZE < memberList.length) {
      const batchMemberList = memberList.slice(
        BATCH_SIZE * batchIndex,
        BATCH_SIZE * (batchIndex + 1),
      )
      await Promise.all(
        batchMemberList.map(
          c => c.ready().catch(e => log.error('Room', 'ready() member.ready() exception:\n%s', e.stack))
        ),
      )

      batchIndex++
    }
  }

  /**
   * @ignore
   */
  public isReady (): boolean {
    return !!(this.payload)
  }

  public say (text:     string)                                  : Promise<void | Message>
  public say (num:      number)                                  : Promise<void | Message>
  public say (message:  Message)                                 : Promise<void | Message>
  public say (text:     string, ...mentionList: Contact[])       : Promise<void | Message>
  public say (textList: TemplateStringsArray, ...varList: any[]) : Promise<void | Message>
  public say (file:     FileBox)                                 : Promise<void | Message>
  public say (url:      UrlLink)                                 : Promise<void | Message>
  public say (mini:     MiniProgram)                             : Promise<void | Message>
  public say (contact:  Contact)                                 : Promise<void | Message>

  // Huan(202006): allow fall down to the defination to get more flexibility.
  // public say (...args: never[]): never

  /**
   * Send message inside Room, if set [replyTo], wechaty will mention the contact as well.
   * > Tips:
   * This function is depending on the Puppet Implementation, see [puppet-compatible-table](https://github.com/wechaty/wechaty/wiki/Puppet#3-puppet-compatible-table)
   *
   * @param {(string | Contact | FileBox)} textOrContactOrFileOrUrlOrMini - Send `text` or `media file` inside Room. <br>
   * You can use {@link https://www.npmjs.com/package/file-box|FileBox} to send file
   * @param {(Contact | Contact[])} [mention] - Optional parameter, send content inside Room, and mention @replyTo contact or contactList.
   * @returns {Promise<void | Message>}
   *
   * @example
   * const bot = new Wechaty()
   * await bot.start()
   * // after logged in...
   * const room = await bot.Room.find({topic: 'wechaty'})
   *
   * // 1. Send text inside Room
   *
   * await room.say('Hello world!')
   * const msg = await room.say('Hello world!') // only supported by puppet-padplus
   *
   * // 2. Send media file inside Room
   * import { FileBox }  from 'wechaty'
   * const fileBox1 = FileBox.fromUrl('https://wechaty.github.io/wechaty/images/bot-qr-code.png')
   * const fileBox2 = FileBox.fromLocal('/tmp/text.txt')
   * await room.say(fileBox1)
   * const msg1 = await room.say(fileBox1) // only supported by puppet-padplus
   * await room.say(fileBox2)
   * const msg2 = await room.say(fileBox2) // only supported by puppet-padplus
   *
   * // 3. Send Contact Card in a room
   * const contactCard = await bot.Contact.find({name: 'lijiarui'}) // change 'lijiarui' to any of the room member
   * await room.say(contactCard)
   * const msg = await room.say(contactCard) // only supported by puppet-padplus
   *
   * // 4. Send text inside room and mention @mention contact
   * const contact = await bot.Contact.find({name: 'lijiarui'}) // change 'lijiarui' to any of the room member
   * await room.say('Hello world!', contact)
   * const msg = await room.say('Hello world!', contact) // only supported by puppet-padplus
   *
   * // 5. Send text inside room and mention someone with Tagged Template
   * const contact2 = await bot.Contact.find({name: 'zixia'}) // change 'zixia' to any of the room member
   * await room.say`Hello ${contact}, here is the world ${contact2}`
   * const msg = await room.say`Hello ${contact}, here is the world ${contact2}` // only supported by puppet-padplus
   *
   * // 6. send url link in a room
   *
   * const urlLink = new UrlLink ({
   *   description : 'WeChat Bot SDK for Individual Account, Powered by TypeScript, Docker, and Love',
   *   thumbnailUrl: 'https://avatars0.githubusercontent.com/u/25162437?s=200&v=4',
   *   title       : 'Welcome to Wechaty',
   *   url         : 'https://github.com/wechaty/wechaty',
   * })
   * await room.say(urlLink)
   * const msg = await room.say(urlLink) // only supported by puppet-padplus
   *
   * // 7. send mini program in a room
   *
   * const miniProgram = new MiniProgram ({
   *   username           : 'gh_xxxxxxx',     //get from mp.weixin.qq.com
   *   appid              : '',               //optional, get from mp.weixin.qq.com
   *   title              : '',               //optional
   *   pagepath           : '',               //optional
   *   description        : '',               //optional
   *   thumbnailurl       : '',               //optional
   * })
   * await room.say(miniProgram)
   * const msg = await room.say(miniProgram) // only supported by puppet-padplus
   */
  public async say (
    something : string
              | number
              | Message
              | Contact
              | FileBox
              | MiniProgram
              | TemplateStringsArray
              | UrlLink,
    ...varList : unknown[]
  ): Promise<void | Message> {

    log.verbose('Room', 'say(%s, %s)',
      something,
      varList.join(', '),
    )

    let text: string
    let msgId: string | void

    if (something instanceof Message) {
      return something.forward(this)
    }

    function isTemplateStringArray (tsa: any): tsa is TemplateStringsArray {
      return tsa instanceof Array
    }

    /**
     *
     * 0. TemplateStringArray
     *
     */
    if (isTemplateStringArray(something)) {
      const msgId = await this.sayTemplateStringsArray(
        something as TemplateStringsArray,
        ...varList,
      )

      if (!msgId) {
        return
      }

      const msg = this.wechaty.Message.load(msgId)
      await msg.ready()
      return msg
    }

    /**
     *
     * Other conditions
     *
     */
    if (typeof something === 'number') {
      something = String(something)
    }

    if (typeof something === 'string') {
      /**
       * 1. string
       */
      let mentionList: Contact[] = []

      if (varList.length > 0) {

        const allIsContact = varList.every(c => c instanceof Contact)
        if (!allIsContact) {
          throw new Error('mentionList must be contact when not using TemplateStringArray function call.')
        }

        mentionList = [...varList as any]

        const AT_SEPARATOR = FOUR_PER_EM_SPACE
        const mentionAlias = await Promise.all(mentionList.map(async contact =>
          '@' + (await this.alias(contact) || contact.name())
        ))
        const mentionText = mentionAlias.join(AT_SEPARATOR)

        text = mentionText + ' ' + something
      } else {
        text = something
      }
      // const receiver = {
      //   contactId : (mentionList.length && mentionList[0].id) || undefined,
      //   roomId    : this.id,
      // }
      msgId = await this.wechaty.puppet.messageSendText(
        this.id,
        text,
        mentionList.map(c => c.id),
      )
    } else if (looseInstanceOfFileBox(something)) {
      /**
       * 2. File Message
       */
      msgId = await this.wechaty.puppet.messageSendFile(
        this.id,
        something,
      )
    } else if (something instanceof Contact) {
      /**
       * 3. Contact Card
       */
      msgId = await this.wechaty.puppet.messageSendContact(
        this.id,
        something.id,
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
      throw new Error('arg unsupported: ' + something)
    }

    if (msgId) {
      const msg = this.wechaty.Message.load(msgId)
      await msg.ready()
      return msg
    }
  }

  private async sayTemplateStringsArray (
    textList: TemplateStringsArray,
    ...varList: unknown[]
  ) {
    const mentionList: Contact[] = varList.filter(v => v instanceof Contact) as any
    // const receiver = {
    //   contactId : (mentionList.length && mentionList[0].id) || undefined,
    //   roomId    : this.id,
    // }
    if (varList.length === 0) {
      /**
       * No mention in the string
       */
      return this.wechaty.puppet.messageSendText(
        this.id,
        textList[0]!,
      )
    // TODO(huan) 20191222 it seems the following code will not happen,
    //            because it's equal the mentionList.length === 0 situation?
    //
    // XXX(huan) 20200101: See issue https://github.com/wechaty/wechaty/issues/1893
    //           This is an anti-pattern usage.
    //
    // } else if (textList.length === 1) {
    //   /**
    //    * Constructed mention string, skip inserting @ signs
    //    */
    //   return this.wechaty.puppet.messageSendText(
    //     receiver,
    //     textList[0],
    //     mentionList.map(c => c.id),
    //   )
    } else {  // mentionList.length > 0
      /**
       * Mention in the string
       */
      const textListLength = textList.length
      const varListLength  = varList.length
      if (textListLength - varListLength !== 1) {
        throw new Error('Can not say message, invalid Template String Array.')
      }
      let finalText = ''

      let i = 0
      for (; i < varListLength; i++) {
        if (varList[i] instanceof Contact) {
          const mentionContact: Contact = varList[i] as any
          const mentionName = await this.alias(mentionContact) || mentionContact.name()
          finalText += textList[i] + '@' + mentionName
        } else {
          finalText += textList[i]! + varList[i]!
        }
      }
      finalText += textList[i]

      return this.wechaty.puppet.messageSendText(
        this.id,
        finalText,
        mentionList.map(c => c.id),
      )
    }
  }

  // public emit (event: 'invite',  inviter:       Contact,    invitation: RoomInvitation)                  : boolean
  // public emit (event: 'leave',   leaverList:    Contact[],  remover:  Contact, date: Date)                    : boolean
  // public emit (event: 'message', message:       Message)                                                      : boolean
  // public emit (event: 'join',    inviteeList:   Contact[],  inviter:  Contact, date: Date)                    : boolean
  // public emit (event: 'topic',   topic:         string,     oldTopic: string,  changer: Contact, date: Date)  : boolean
  // public emit (event: never, ...args: never[]): never

  // public emit (
  //   event:   RoomEventName,
  //   ...args: any[]
  // ): boolean {
  //   return super.emit(event, ...args)
  // }

  // public on (event: 'invite',  listener: (this: Room, inviter: Contact, invitation: RoomInvitation) => void)               : this
  // public on (event: 'leave',   listener: (this: Room, leaverList:  Contact[], remover?:  Contact, date?: Date) => void)                   : this
  // public on (event: 'message', listener: (this: Room, message:  Message, date?: Date) => void)                             : this
  // public on (event: 'join',    listener: (this: Room, inviteeList: Contact[], inviter:  Contact,  date?: Date) => void)                   : this
  // public on (event: 'topic',   listener: (this: Room, topic:       string,    oldTopic: string,   changer: Contact, date?: Date) => void) : this
  // public on (event: never,   ...args: never[])                                                                            : never

  /**
   * @desc       Room Class Event Type
   * @typedef    RoomEventName
   * @property   {string}  join  - Emit when anyone join any room.
   * @property   {string}  topic - Get topic event, emitted when someone change room topic.
   * @property   {string}  leave - Emit when anyone leave the room.<br>
   *                               If someone leaves the room by themselves, WeChat will not notice other people in the room, so the bot will never get the "leave" event.
   */

  /**
   * @desc       Room Class Event Function
   * @typedef    RoomEventFunction
   * @property   {Function} room-join       - (this: Room, inviteeList: Contact[] , inviter: Contact)  => void
   * @property   {Function} room-topic      - (this: Room, topic: string, oldTopic: string, changer: Contact) => void
   * @property   {Function} room-leave      - (this: Room, leaver: Contact) => void
   */

  /**
   * @listens Room
   * @param   {RoomEventName}      event      - Emit WechatyEvent
   * @param   {RoomEventFunction}  listener   - Depends on the WechatyEvent
   * @return  {this}                          - this for chain
   *
   * @example <caption>Event:join </caption>
   * const bot = new Wechaty()
   * await bot.start()
   * // after logged in...
   * const room = await bot.Room.find({topic: 'topic of your room'}) // change `event-room` to any room topic in your WeChat
   * if (room) {
   *   room.on('join', (room, inviteeList, inviter) => {
   *     const nameList = inviteeList.map(c => c.name()).join(',')
   *     console.log(`Room got new member ${nameList}, invited by ${inviter}`)
   *   })
   * }
   *
   * @example <caption>Event:leave </caption>
   * const bot = new Wechaty()
   * await bot.start()
   * // after logged in...
   * const room = await bot.Room.find({topic: 'topic of your room'}) // change `event-room` to any room topic in your WeChat
   * if (room) {
   *   room.on('leave', (room, leaverList) => {
   *     const nameList = leaverList.map(c => c.name()).join(',')
   *     console.log(`Room lost member ${nameList}`)
   *   })
   * }
   *
   * @example <caption>Event:message </caption>
   * const bot = new Wechaty()
   * await bot.start()
   * // after logged in...
   * const room = await bot.Room.find({topic: 'topic of your room'}) // change `event-room` to any room topic in your WeChat
   * if (room) {
   *   room.on('message', (message) => {
   *     console.log(`Room received new message: ${message}`)
   *   })
   * }
   *
   * @example <caption>Event:topic </caption>
   * const bot = new Wechaty()
   * await bot.start()
   * // after logged in...
   * const room = await bot.Room.find({topic: 'topic of your room'}) // change `event-room` to any room topic in your WeChat
   * if (room) {
   *   room.on('topic', (room, topic, oldTopic, changer) => {
   *     console.log(`Room topic changed from ${oldTopic} to ${topic} by ${changer.name()}`)
   *   })
   * }
   *
   * @example <caption>Event:invite </caption>
   * const bot = new Wechaty()
   * await bot.start()
   * // after logged in...
   * const room = await bot.Room.find({topic: 'topic of your room'}) // change `event-room` to any room topic in your WeChat
   * if (room) {
   *   room.on('invite', roomInvitation => roomInvitation.accept())
   * }
   *
   */
  // public on (event: RoomEventName, listener: (...args: any[]) => any): this {
  //   log.verbose('Room', 'on(%s, %s)', event, typeof listener)

  //   super.on(event, listener) // Room is `Sayable`
  //   return this
  // }

  /**
   * Add contact in a room
   *
   * > Tips:
   * This function is depending on the Puppet Implementation, see [puppet-compatible-table](https://github.com/wechaty/wechaty/wiki/Puppet#3-puppet-compatible-table)
   * >
   * > see {@link https://github.com/wechaty/wechaty/issues/1441|Web version of WeChat closed group interface}
   *
   * @param {Contact} contact
   * @returns {Promise<void>}
   * @example
   * const bot = new Wechaty()
   * await bot.start()
   * // after logged in...
   * const contact = await bot.Contact.find({name: 'lijiarui'}) // change 'lijiarui' to any contact in your WeChat
   * const room = await bot.Room.find({topic: 'WeChat'})        // change 'WeChat' to any room topic in your WeChat
   * if (room) {
   *   try {
   *      await room.add(contact)
   *   } catch(e) {
   *      console.error(e)
   *   }
   * }
   */
  public async add (contact: Contact): Promise<void> {
    log.verbose('Room', 'add(%s)', contact)
    await this.wechaty.puppet.roomAdd(this.id, contact.id)
  }

  /**
   * Remove a contact from the room
   * It works only when the bot is the owner of the room
   *
   * > Tips:
   * This function is depending on the Puppet Implementation, see [puppet-compatible-table](https://github.com/wechaty/wechaty/wiki/Puppet#3-puppet-compatible-table)
   * >
   * > see {@link https://github.com/wechaty/wechaty/issues/1441|Web version of WeChat closed group interface}
   *
   * @param {Contact} contact
   * @returns {Promise<void>}
   * @example
   * const bot = new Wechaty()
   * await bot.start()
   * // after logged in...
   * const room = await bot.Room.find({topic: 'WeChat'})          // change 'WeChat' to any room topic in your WeChat
   * const contact = await bot.Contact.find({name: 'lijiarui'})   // change 'lijiarui' to any room member in the room you just set
   * if (room) {
   *   try {
   *      await room.remove(contact)
   *   } catch(e) {
   *      console.error(e)
   *   }
   * }
   */
  public async remove (contact: Contact): Promise<void> {
    log.verbose('Room', 'del(%s)', contact)
    await this.wechaty.puppet.roomDel(this.id, contact.id)
    // this.delLocal(contact)
  }

  /**
   * @deprecated use remove(contact) instead.
   *
   * Huan(202106): will be removed after Dec 31, 2023
   */
  public async del (contact: Contact): Promise<void> {
    log.verbose('Room', 'del(%s)', contact)
    log.warn('Room', 'del() is DEPRECATED, use remove() instead.')

    return this.remove(contact)
  }

  // private delLocal(contact: Contact): void {
  //   log.verbose('Room', 'delLocal(%s)', contact)

  //   const memberIdList = this.payload && this.payload.memberIdList
  //   if (memberIdList && memberIdList.length > 0) {
  //     for (let i = 0; i < memberIdList.length; i++) {
  //       if (memberIdList[i] === contact.id) {
  //         memberIdList.splice(i, 1)
  //         break
  //       }
  //     }
  //   }
  // }

  /**
   * Bot quit the room itself
   *
   * > Tips:
   * This function is depending on the Puppet Implementation, see [puppet-compatible-table](https://github.com/wechaty/wechaty/wiki/Puppet#3-puppet-compatible-table)
   *
   * @returns {Promise<void>}
   * @example
   * await room.quit()
   */
  public async quit (): Promise<void> {
    log.verbose('Room', 'quit() %s', this)
    await this.wechaty.puppet.roomQuit(this.id)
  }

  public async topic ()                : Promise<string>
  public async topic (newTopic: string): Promise<void>

  /**
   * SET/GET topic from the room
   *
   * @param {string} [newTopic] If set this para, it will change room topic.
   * @returns {Promise<string | void>}
   *
   * @example <caption>When you say anything in a room, it will get room topic. </caption>
   * const bot = new Wechaty()
   * bot
   * .on('message', async m => {
   *   const room = m.room()
   *   if (room) {
   *     const topic = await room.topic()
   *     console.log(`room topic is : ${topic}`)
   *   }
   * })
   * .start()
   *
   * @example <caption>When you say anything in a room, it will change room topic. </caption>
   * const bot = new Wechaty()
   * bot
   * .on('message', async m => {
   *   const room = m.room()
   *   if (room) {
   *     const oldTopic = await room.topic()
   *     await room.topic('change topic to wechaty!')
   *     console.log(`room topic change from ${oldTopic} to ${room.topic()}`)
   *   }
   * })
   * .start()
   */
  public async topic (newTopic?: string): Promise<void | string> {
    log.verbose('Room', 'topic(%s)', newTopic || '')
    if (!this.isReady()) {
      log.warn('Room', 'topic() room not ready')
      throw new Error('not ready')
    }

    if (typeof newTopic === 'undefined') {
      if (this.payload && this.payload.topic) {
        return this.payload.topic
      } else {
        const memberIdList = await this.wechaty.puppet.roomMemberList(this.id)
        const memberList = memberIdList
          .filter(id => id !== this.wechaty.puppet.selfId())
          .map(id => this.wechaty.Contact.load(id))

        let defaultTopic = (memberList[0] && memberList[0].name()) || ''
        for (let i = 1; i < 3 && memberList[i]; i++) {
          defaultTopic += ',' + memberList[i]!.name()
        }
        return defaultTopic
      }
    }

    const future = this.wechaty.puppet
      .roomTopic(this.id, newTopic)
      .catch(e => {
        log.warn('Room', 'topic(newTopic=%s) exception: %s',
          newTopic, (e && e.message) || e,
        )
        Raven.captureException(e)
      })

    return future
  }

  public async announce ()             : Promise<string>
  public async announce (text: string) : Promise<void>

  /**
   * SET/GET announce from the room
   * > Tips: It only works when bot is the owner of the room.
   * >
   * > This function is depending on the Puppet Implementation, see [puppet-compatible-table](https://github.com/wechaty/wechaty/wiki/Puppet#3-puppet-compatible-table)
   *
   * @param {string} [text] If set this para, it will change room announce.
   * @returns {(Promise<void | string>)}
   *
   * @example <caption>When you say anything in a room, it will get room announce. </caption>
   * const bot = new Wechaty()
   * await bot.start()
   * // after logged in...
   * const room = await bot.Room.find({topic: 'your room'})
   * const announce = await room.announce()
   * console.log(`room announce is : ${announce}`)
   *
   * @example <caption>When you say anything in a room, it will change room announce. </caption>
   * const bot = new Wechaty()
   * await bot.start()
   * // after logged in...
   * const room = await bot.Room.find({topic: 'your room'})
   * const oldAnnounce = await room.announce()
   * await room.announce('change announce to wechaty!')
   * console.log(`room announce change from ${oldAnnounce} to ${room.announce()}`)
   */
  public async announce (text?: string): Promise<void | string> {
    log.verbose('Room', 'announce(%s)',
      typeof text === 'undefined'
        ? ''
        : `"${text || ''}"`
    )

    if (typeof text === 'undefined') {
      const announcement = await this.wechaty.puppet.roomAnnounce(this.id)
      return announcement
    } else {
      await this.wechaty.puppet.roomAnnounce(this.id, text)
    }
  }

  /**
   * Get QR Code Value of the Room from the room, which can be used as scan and join the room.
   * > Tips:
   * 1. This function is depending on the Puppet Implementation, see [puppet-compatible-table](https://github.com/wechaty/wechaty/wiki/Puppet#3-puppet-compatible-table)
   * 2. The return should be the QR Code Data, instead of the QR Code Image. (the data should be less than 8KB. See: https://stackoverflow.com/a/12764370/1123955 )
   * @returns {Promise<string>}
   */
  public async qrCode (): Promise<string> {
    log.verbose('Room', 'qrCode()')
    const qrcodeValue = await this.wechaty.puppet.roomQRCode(this.id)
    return guardQrCodeValue(qrcodeValue)
  }

  /**
   * Return contact's roomAlias in the room
   * @param {Contact} contact
   * @returns {Promise<string | null>} - If a contact has an alias in room, return string, otherwise return null
   * @example
   * const bot = new Wechaty()
   * bot
   * .on('message', async m => {
   *   const room = m.room()
   *   const contact = m.from()
   *   if (room) {
   *     const alias = await room.alias(contact)
   *     console.log(`${contact.name()} alias is ${alias}`)
   *   }
   * })
   * .start()
   */
  public async alias (contact: Contact): Promise<null | string> {
    const memberPayload = await this.wechaty.puppet.roomMemberPayload(this.id, contact.id)

    if (memberPayload && memberPayload.roomAlias) {
      return memberPayload.roomAlias
    }

    return null
  }

  /**
   * Mark the conversation as read
   * @param {boolean} hasRead
   *
   * @example
   * const bot = new Wechaty()
   * const room = await bot.Room.find({topic: 'xxx'})
   * await room.readMark()
   */
  public async readMark (hasRead?: boolean): Promise<void | boolean> {
    try {
      return this.wechaty.puppet.conversationReadMark(this.id, hasRead)
    } catch (e) {
      log.error('Room', 'readMark() exception: %s', e.message)
    }
  }

  /**
   * Check if the room has member `contact`, the return is a Promise and must be `await`-ed
   *
   * @param {Contact} contact
   * @returns {Promise<boolean>} Return `true` if has contact, else return `false`.
   * @example <caption>Check whether 'lijiarui' is in the room 'wechaty'</caption>
   * const bot = new Wechaty()
   * await bot.start()
   * // after logged in...
   * const contact = await bot.Contact.find({name: 'lijiarui'})   // change 'lijiarui' to any of contact in your WeChat
   * const room = await bot.Room.find({topic: 'wechaty'})         // change 'wechaty' to any of the room in your WeChat
   * if (contact && room) {
   *   if (await room.has(contact)) {
   *     console.log(`${contact.name()} is in the room wechaty!`)
   *   } else {
   *     console.log(`${contact.name()} is not in the room wechaty!`)
   *   }
   * }
   */
  public async has (contact: Contact): Promise<boolean> {
    const memberIdList = await this.wechaty.puppet.roomMemberList(this.id)

    if (!memberIdList) {
      return false
    }

    return memberIdList
      .filter(id => id === contact.id)
      .length > 0
  }

  public async memberAll ()                              : Promise<Contact[]>
  public async memberAll (name: string)                  : Promise<Contact[]>
  public async memberAll (filter: RoomMemberQueryFilter) : Promise<Contact[]>

  /**
   * The way to search member by Room.member()
   *
   * @typedef    RoomMemberQueryFilter
   * @property   {string} name            -Find the contact by WeChat name in a room, equal to `Contact.name()`.
   * @property   {string} roomAlias       -Find the contact by alias set by the bot for others in a room.
   * @property   {string} contactAlias    -Find the contact by alias set by the contact out of a room, equal to `Contact.alias()`.
   * [More Detail]{@link https://github.com/wechaty/wechaty/issues/365}
   */

  /**
   * Find all contacts in a room
   *
   * #### definition
   * - `name`                 the name-string set by user-self, should be called name, equal to `Contact.name()`
   * - `roomAlias`            the name-string set by user-self in the room, should be called roomAlias
   * - `contactAlias`         the name-string set by bot for others, should be called alias, equal to `Contact.alias()`
   * @param {(RoomMemberQueryFilter | string)} [query] -Optional parameter, When use memberAll(name:string), return all matched members, including name, roomAlias, contactAlias
   * @returns {Promise<Contact[]>}
   * @example
   * const roomList:Contact[] | null = await room.findAll()
   * if(roomList)
   *  console.log(`room all member list: `, roomList)
   * const memberContactList: Contact[] | null =await room.findAll(`abc`)
   * console.log(`contact list with all name, room alias, alias are abc:`, memberContactList)
   */
  public async memberAll (
    query?: string | RoomMemberQueryFilter,
  ): Promise<Contact[]> {
    log.silly('Room', 'memberAll(%s)',
      JSON.stringify(query) || '',
    )

    if (!query) {
      return this.memberList()
    }

    const contactIdList = await this.wechaty.puppet.roomMemberSearch(this.id, query)
    const contactList   = contactIdList.map(id => this.wechaty.Contact.load(id))

    return contactList
  }

  public async member (name  : string)               : Promise<null | Contact>
  public async member (filter: RoomMemberQueryFilter): Promise<null | Contact>

  /**
   * Find all contacts in a room, if get many, return the first one.
   *
   * @param {(RoomMemberQueryFilter | string)} queryArg -When use member(name:string), return all matched members, including name, roomAlias, contactAlias
   * @returns {Promise<null | Contact>}
   *
   * @example <caption>Find member by name</caption>
   * const bot = new Wechaty()
   * await bot.start()
   * // after logged in...
   * const room = await bot.Room.find({topic: 'wechaty'})           // change 'wechaty' to any room name in your WeChat
   * if (room) {
   *   const member = await room.member('lijiarui')             // change 'lijiarui' to any room member in your WeChat
   *   if (member) {
   *     console.log(`wechaty room got the member: ${member.name()}`)
   *   } else {
   *     console.log(`cannot get member in wechaty room!`)
   *   }
   * }
   *
   * @example <caption>Find member by MemberQueryFilter</caption>
   * const bot = new Wechaty()
   * await bot.start()
   * // after logged in...
   * const room = await bot.Room.find({topic: 'wechaty'})          // change 'wechaty' to any room name in your WeChat
   * if (room) {
   *   const member = await room.member({name: 'lijiarui'})        // change 'lijiarui' to any room member in your WeChat
   *   if (member) {
   *     console.log(`wechaty room got the member: ${member.name()}`)
   *   } else {
   *     console.log(`cannot get member in wechaty room!`)
   *   }
   * }
   */
  public async member (
    queryArg: string | RoomMemberQueryFilter,
  ): Promise<null | Contact> {
    log.verbose('Room', 'member(%s)', JSON.stringify(queryArg))

    let memberList: Contact[]
    // ISSUE #622
    // error TS2345: Argument of type 'string | MemberQueryFilter' is not assignable to parameter of type 'MemberQueryFilter' #622
    if (typeof queryArg === 'string') {
      memberList =  await this.memberAll(queryArg)
    } else {
      memberList =  await this.memberAll(queryArg)
    }

    if (!memberList || !memberList.length) {
      return null
    }

    if (memberList.length > 1) {
      log.warn('Room', 'member(%s) get %d contacts, use the first one by default', JSON.stringify(queryArg), memberList.length)
    }
    return memberList[0]!
  }

  /**
    * @ignore
   * @ignore
   *
   * Get all room member from the room
   *
   * @returns {Promise<Contact[]>}
   * @example
   * await room.memberList()
   */
  private async memberList (): Promise<Contact[]> {
    log.verbose('Room', 'memberList()')

    const memberIdList = await this.wechaty.puppet.roomMemberList(this.id)

    if (!memberIdList) {
      log.warn('Room', 'memberList() not ready')
      return []
    }

    const contactList = memberIdList.map(
      id => this.wechaty.Contact.load(id),
    )
    return contactList
  }

  /**
   * Get room's owner from the room.
   * > Tips:
   * This function is depending on the Puppet Implementation, see [puppet-compatible-table](https://github.com/wechaty/wechaty/wiki/Puppet#3-puppet-compatible-table)
   * @returns {(Contact | null)}
   * @example
   * const owner = room.owner()
   */
  public owner (): null | Contact {
    log.verbose('Room', 'owner()')

    const ownerId = this.payload && this.payload.ownerId
    if (!ownerId) {
      return null
    }

    const owner = this.wechaty.Contact.load(ownerId)
    return owner
  }

  /**
   * Get avatar from the room.
   * @returns {FileBox}
   * @example
   * const fileBox = await room.avatar()
   * const name = fileBox.name
   * fileBox.toFile(name)
   */
  public async avatar (): Promise<FileBox> {
    log.verbose('Room', 'avatar()')

    return this.wechaty.puppet.roomAvatar(this.id)
  }

}

function wechatifyRoom (wechaty: Wechaty): typeof Room {

  class WechatifiedRoom extends Room {

    static override get wechaty  () { return wechaty }
    override get wechaty        () { return wechaty }

  }

  return WechatifiedRoom

}

export {
  Room,
  wechatifyRoom,
}
