/**
 *   Wechaty - https://github.com/chatie/wechaty
 *
 *   @copyright 2016-2018 Huan LI <zixia@zixia.net>
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
 *  @ignore
 */
import cuid    from 'cuid'
import os      from 'os'
import semver  from 'semver'

import {
  // Constructor,
  cloneClass,
  // instanceToClass,
}                   from 'clone-class'
import {
  FileBox,
}                   from 'file-box'
import {
  callerResolve,
  hotImport,
}                   from 'hot-import'
import {
  StateSwitch,
}                   from 'state-switch'
import {
  MemoryCard,
}                   from 'memory-card'

import {
  Puppet,
  PuppetOptions,

  CHAT_EVENT_DICT,
  PUPPET_EVENT_DICT,
  PuppetEventName,
}                       from 'wechaty-puppet'

import {
  Accessory,
}                       from './accessory'
import {
  VERSION,
  config,
  log,
  Raven,
  Sayable,
}                       from './config'

import {
  Io,
}                       from './io'
import {
  PUPPET_DICT,
  PuppetName,
}                       from './puppet-config'

import {
  Contact,
  ContactSelf,
  Friendship,
  Message,
  Room,
}                       from './user/'

// export const WECHAT_EVENT_DICT = {
//   friend      : 'tbw',
//   login       : 'tbw',
//   logout      : 'tbw',
//   message     : 'tbw',
//   'room-join' : 'tbw',
//   'room-leave': 'tbw',
//   'room-topic': 'tbw',
//   scan        : 'tbw',
// }

export const WECHATY_EVENT_DICT = {
  ...CHAT_EVENT_DICT,
  dong      : 'tbw',
  error     : 'tbw',
  heartbeat : 'tbw',
  start     : 'tbw',
  stop      : 'tbw',
}

export type WechatyEventName  = keyof typeof WECHATY_EVENT_DICT

export interface WechatyOptions {
  profile?       : null | string,            // Wechaty Name
  puppet?        : PuppetName | Puppet,      // Puppet name or instance
  puppetOptions? : Partial<PuppetOptions>,   // Puppet TOKEN
  ioToken?       : string,                   // Io TOKEN
}

/**
 * Main bot class.
 *
 * [The World's Shortest ChatBot Code: 6 lines of JavaScript]{@link #wechatyinstance}
 *
 * [Wechaty Starter Project]{@link https://github.com/lijiarui/wechaty-getting-started}
 * @example
 * import { Wechaty } from 'wechaty'
 *
 */
export class Wechaty extends Accessory implements Sayable {

  public readonly state  : StateSwitch

  /**
   * singleton globalInstance
   * @private
   */
  private static globalInstance: Wechaty

  private readonly memory : MemoryCard

  private lifeTimer? : NodeJS.Timer
  private io?        : Io

  /**
   * the cuid
   * @private
   */
  public readonly id : string

  /**
   * @private
   */
  // tslint:disable-next-line:variable-name
  public readonly Contact       : typeof Contact

  /**
   * @private
   */
  // tslint:disable-next-line:variable-name
  public readonly ContactSelf   : typeof ContactSelf

  /**
   * @private
   */
  // tslint:disable-next-line:variable-name
  public readonly Friendship    : typeof Friendship

  /**
   * @private
   */
  // tslint:disable-next-line:variable-name
  public readonly Message       : typeof Message

  /**
   * @private
   */
  // tslint:disable-next-line:variable-name
  public readonly Room          : typeof Room

  /**
   * get the singleton instance of Wechaty
   *
   * @example <caption>The World's Shortest ChatBot Code: 6 lines of JavaScript</caption>
   * const { Wechaty } = require('wechaty')
   *
   * Wechaty.instance() // Singleton
   * .on('scan', (url, code) => console.log(`Scan QR Code to login: ${code}\n${url}`))
   * .on('login',       user => console.log(`User ${user} logined`))
   * .on('message',  message => console.log(`Message: ${message}`))
   * .init()
   */
  public static instance(
    options?: WechatyOptions,
  ) {
    if (options && this.globalInstance) {
      throw new Error('instance can be only inited once by options!')
    }
    if (!this.globalInstance) {
      this.globalInstance = new Wechaty(options)
    }
    return this.globalInstance
  }

  /**
   * @public
   */
  constructor(
    private options: WechatyOptions = {},
  ) {
    super()
    log.verbose('Wechaty', 'contructor()')

    options.profile = options.profile === null
                      ? null
                      : (options.profile || config.default.DEFAULT_PROFILE)

    this.memory = new MemoryCard(options.profile || undefined)
    this.state  = new StateSwitch('Wechaty', log)
    this.id     = cuid()

    /**
     * Clone Classes for this bot and attach the `puppet` to the Class
     *
     *   https://stackoverflow.com/questions/36886082/abstract-constructor-type-in-typescript
     *   https://github.com/Microsoft/TypeScript/issues/5843#issuecomment-290972055
     *   https://github.com/Microsoft/TypeScript/issues/19197
     */
    // TODO: make Message & Room constructor private???
    this.Contact     = cloneClass(Contact)
    this.ContactSelf = cloneClass(ContactSelf)
    this.Friendship  = cloneClass(Friendship)
    this.Message     = cloneClass(Message)
    this.Room        = cloneClass(Room)
  }

  /**
   * @private
   */
  public toString() {
    if (!this.options) {
      return this.constructor.name
    }

    return [
      'Wechaty#',
      this.id,
      `<${this.options && this.options.puppet || ''}>`,
      `(${this.memory  && this.memory.name    || ''})`,
    ].join('')
  }

  /**
   * @private
   */
  public static version(forceNpm = false): string {
    if (!forceNpm) {
      const revision = config.gitRevision()
      if (revision) {
        return `#git[${revision}]`
      }
    }
    return VERSION
  }

 /**
  * Return version of Wechaty
  *
  * @param {boolean} [forceNpm=false]  - if set to true, will only return the version in package.json.
  *                                      otherwise will return git commit hash if .git exists.
  * @returns {string}                  - the version number
  * @example
  * console.log(Wechaty.instance().version())       // return '#git[af39df]'
  * console.log(Wechaty.instance().version(true))   // return '0.7.9'
  */
  public version(forceNpm = false): string {
    return Wechaty.version(forceNpm)
  }

  public emit(event: 'dong'       , data?: string)                                                    : boolean
  public emit(event: 'error'      , error: Error)                                                     : boolean
  public emit(event: 'friendship' , friendship: Friendship)                                           : boolean
  public emit(event: 'heartbeat'  , data: any)                                                        : boolean
  public emit(event: 'logout'     , user: ContactSelf)                                                : boolean
  public emit(event: 'login'      , user: ContactSelf)                                                : boolean
  public emit(event: 'message'    , message: Message)                                                 : boolean
  public emit(event: 'room-join'  , room: Room, inviteeList : Contact[], inviter  : Contact)          : boolean
  public emit(event: 'room-leave' , room: Room, leaverList  : Contact[], remover? : Contact)          : boolean
  public emit(event: 'room-topic' , room: Room, newTopic: string, oldTopic: string, changer: Contact) : boolean
  public emit(event: 'scan'       , qrcode: string, status: number, data?: string)                    : boolean
  public emit(event: 'start')                                                                         : boolean
  public emit(event: 'stop')                                                                          : boolean

  // guard for the above event: make sure it includes all the possible values
  public emit(event: never, listener: never): never

  public emit(
    event:   WechatyEventName,
    ...args: any[]
  ): boolean {
    return super.emit(event, ...args)
  }

  public on(event: 'dong'       , listener: string | ((this: Wechaty, data?: string) => void))                                                     : this
  public on(event: 'error'      , listener: string | ((this: Wechaty, error: Error) => void))                                                     : this
  public on(event: 'friendship' , listener: string | ((this: Wechaty, friendship: Friendship) => void))                                           : this
  public on(event: 'heartbeat'  , listener: string | ((this: Wechaty, data: any) => void))                                                        : this
  public on(event: 'logout'     , listener: string | ((this: Wechaty, user: ContactSelf) => void))                                                : this
  public on(event: 'login'      , listener: string | ((this: Wechaty, user: ContactSelf) => void))                                                : this
  public on(event: 'message'    , listener: string | ((this: Wechaty, message: Message) => void))                                                 : this
  public on(event: 'room-join'  , listener: string | ((this: Wechaty, room: Room, inviteeList: Contact[],  inviter: Contact) => void))            : this
  public on(event: 'room-leave' , listener: string | ((this: Wechaty, room: Room, leaverList: Contact[], remover?: Contact) => void))             : this
  public on(event: 'room-topic' , listener: string | ((this: Wechaty, room: Room, newTopic: string, oldTopic: string, changer: Contact) => void)) : this
  public on(event: 'scan'       , listener: string | ((this: Wechaty, qrcode: string, status: number, data?: string) => void))                    : this
  public on(event: 'start'      , listener: string | ((this: Wechaty) => void))                                                                   : this
  public on(event: 'stop'       , listener: string | ((this: Wechaty) => void))                                                                   : this

  // guard for the above event: make sure it includes all the possible values
  public on(event: never, listener: never): never

  /**
   * @desc       Wechaty Class Event Type
   * @typedef    WechatyEventName
   * @property   {string}  error      - When the bot get error, there will be a Wechaty error event fired.
   * @property   {string}  login      - After the bot login full successful, the event login will be emitted, with a Contact of current logined user.
   * @property   {string}  logout     - Logout will be emitted when bot detected log out, with a Contact of the current login user.
   * @property   {string}  heartbeat  - Get bot's heartbeat.
   * @property   {string}  friend     - When someone sends you a friend request, there will be a Wechaty friend event fired.
   * @property   {string}  message    - Emit when there's a new message.
   * @property   {string}  room-join  - Emit when anyone join any room.
   * @property   {string}  room-topic - Get topic event, emitted when someone change room topic.
   * @property   {string}  room-leave - Emit when anyone leave the room.<br>
   *                                    If someone leaves the room by themselves, wechat will not notice other people in the room, so the bot will never get the "leave" event.
   * @property   {string}  scan       - A scan event will be emitted when the bot needs to show you a QR Code for scanning.
   */

  /**
   * @desc       Wechaty Class Event Function
   * @typedef    WechatyEventFunction
   * @property   {Function} error           -(this: Wechaty, error: Error) => void callback function
   * @property   {Function} login           -(this: Wechaty, user: ContactSelf)=> void
   * @property   {Function} logout          -(this: Wechaty, user: ContactSelf) => void
   * @property   {Function} scan            -(this: Wechaty, url: string, code: number) => void <br>
   * <ol>
   * <li>URL: {String} the QR code image URL</li>
   * <li>code: {Number} the scan status code. some known status of the code list here is:</li>
   * </ol>
   * <ul>
   * <li>0 initial_</li>
   * <li>200 login confirmed</li>
   * <li>201 scaned, wait for confirm</li>
   * <li>408 waits for scan</li>
   * </ul>
   * @property   {Function} heartbeat       -(this: Wechaty, data: any) => void
   * @property   {Function} friendship      -(this: Wechaty, friendship: Friendship) => void
   * @property   {Function} message         -(this: Wechaty, message: Message) => void
   * @property   {Function} room-join       -(this: Wechaty, room: Room, inviteeList: Contact[],  inviter: Contact) => void
   * @property   {Function} room-topic      -(this: Wechaty, room: Room, newTopic: string, oldTopic: string, changer: Contact) => void
   * @property   {Function} room-leave      -(this: Wechaty, room: Room, leaverList: Contact[]) => void
   */

  /**
   * @listens Wechaty
   * @param   {WechatyEventName}      event      - Emit WechatyEvent
   * @param   {WechatyEventFunction}  listener   - Depends on the WechatyEvent
   * @return  {Wechaty}                          - this for chain
   *
   * More Example Gist: [Examples/Friend-Bot]{@link https://github.com/Chatie/wechaty/blob/master/examples/friend-bot.ts}
   *
   * @example <caption>Event:scan </caption>
   * wechaty.on('scan', (url: string, code: number) => {
   *   console.log(`[${code}] Scan ${url} to login.` )
   * })
   *
   * @example <caption>Event:login </caption>
   * bot.on('login', (user: ContactSelf) => {
   *   console.log(`user ${user} login`)
   * })
   *
   * @example <caption>Event:logout </caption>
   * bot.on('logout', (user: ContactSelf) => {
   *   console.log(`user ${user} logout`)
   * })
   *
   * @example <caption>Event:message </caption>
   * wechaty.on('message', (message: Message) => {
   *   console.log(`message ${message} received`)
   * })
   *
   * @example <caption>Event:friendship </caption>
   * bot.on('friendship', (friendship: Friendship) => {
   *   if(friendship.type() === Friendship.Type.RECEIVE){ // 1. receive new friendship request from new contact
   *     const contact = friendship.contact()
   *     let result = await friendship.accept()
   *       if(result){
   *         console.log(`Request from ${contact.name()} is accept succesfully!`)
   *       } else{
   *         console.log(`Request from ${contact.name()} failed to accept!`)
   *       }
   * 	  } else if (friendship.type() === Friendship.Type.CONFIRM) { // 2. confirm friendship
   *       console.log(`new friendship confirmed with ${contact.name()}`)
   *    }
   *  })
   *
   * @example <caption>Event:room-join </caption>
   * bot.on('room-join', (room: Room, inviteeList: Contact[], inviter: Contact) => {
   *   const nameList = inviteeList.map(c => c.name()).join(',')
   *   console.log(`Room ${room.topic()} got new member ${nameList}, invited by ${inviter}`)
   * })
   *
   * @example <caption>Event:room-leave </caption>
   * bot.on('room-leave', (room: Room, leaverList: Contact[]) => {
   *   const nameList = leaverList.map(c => c.name()).join(',')
   *   console.log(`Room ${room.topic()} lost member ${nameList}`)
   * })
   *
   * @example <caption>Event:room-topic </caption>
   * bot.on('room-topic', (room: Room, topic: string, oldTopic: string, changer: Contact) => {
   *   console.log(`Room ${room.topic()} topic changed from ${oldTopic} to ${topic} by ${changer.name()}`)
   * })
   */
  public on(event: WechatyEventName, listener: string | ((...args: any[]) => any)): this {
    log.verbose('Wechaty', 'on(%s, %s) registered',
                            event,
                            typeof listener === 'string'
                              ? listener
                              : typeof listener,
                )

    // DEPRECATED for 'friend' event
    if (event as any === 'friend') {
      log.warn('Wechaty', `on('friend', contact, friendRequest) is DEPRECATED. use on('friendship', friendship) instead`)
      if (typeof listener === 'function') {
        const oldListener = listener
        listener = (...args: any[]) => {
          log.warn('Wechaty', `on('friend', contact, friendRequest) is DEPRECATED. use on('friendship', friendship) instead`)
          oldListener.apply(this, args)
        }
      }
    }

    if (typeof listener === 'function') {
      this.addListenerFunction(event, listener)
    } else {
      this.addListenerModuleFile(event, listener)
    }
    return this
  }

  private addListenerModuleFile(event: WechatyEventName, modulePath: string): void {
    const absoluteFilename = callerResolve(modulePath, __filename)
    log.verbose('Wechaty', 'onModulePath() hotImpor(%s)', absoluteFilename)
    hotImport(absoluteFilename)
      .then((func: Function) => super.on(event, (...args: any[]) => {
        try {
          func.apply(this, args)
        } catch (e) {
          log.error('Wechaty', 'onModulePath(%s, %s) listener exception: %s',
                                event, modulePath, e)
          this.emit('error', e)
        }
      }))
      .catch(e => {
        log.error('Wechaty', 'onModulePath(%s, %s) hotImport() exception: %s',
                              event, modulePath, e)
        this.emit('error', e)
      })
  }

  private addListenerFunction(event: WechatyEventName, listener: Function): void {
    log.verbose('Wechaty', 'onFunction(%s)', event)

    super.on(event, (...args: any[]) => {
      try {
        listener.apply(this, args)
      } catch (e) {
        log.error('Wechaty', 'onFunction(%s) listener exception: %s', event, e)
        this.emit('error', e)
      }
    })
  }

  private initPuppet(): void {
    log.verbose('Wechaty', 'initPuppet(%s)', this.options.puppet)

    let inited = false
    try {
      inited = !!this.puppet
    } catch (e) {
      inited = false
    }

    if (inited) {
      log.verbose('Wechaty', 'initPuppet(%s) had already been inited, no need to init twice', this.options.puppet)
      return
    }

    const puppet = this.initPuppetResolver(this.options.puppet)

    this.initPuppetVersionSatisfy(puppet)
    this.initPuppetEventBridge(puppet)

    this.initPuppetAccessory(puppet)
  }

  /**
   * @private
   */
  private initPuppetVersionSatisfy(puppet: Puppet): void {
    log.verbose('Wechaty', 'initPuppetVersionSatisfy(%s)', puppet)

    if (this.initPuppetSemverSatisfy(
      puppet.wechatyVersionRange(),
    )) {
      return
    }

    throw new Error(`The Puppet Plugin(${puppet.constructor.name}) `
      + `requires a version range(${puppet.wechatyVersionRange()}) `
      + `that is not satisfying the Wechaty version: ${this.version()}.`,
    )
  }

  /**
   * @private
   *
   * Init the Puppet
   */
  private initPuppetResolver(puppet?: PuppetName | Puppet): Puppet {
    log.verbose('Wechaty', 'initPuppetResolver(%s)', puppet)

    if (!puppet) {
      log.info('Wechaty', 'initPuppet() using puppet: %s', config.puppet)
      puppet  = config.puppet
    }

    if (typeof puppet === 'string') {
      // tslint:disable-next-line:variable-name
      const MyPuppet = PUPPET_DICT[puppet]
      if (!MyPuppet) {
        throw new Error('no such puppet: ' + puppet)
      }

      const options: PuppetOptions = {
        memory : this.memory,
        ...this.options.puppetOptions,
      }

      /**
       * We will meet the following error:
       *
       *  [ts] Cannot use 'new' with an expression whose type lacks a call or construct signature.
       *
       * When we have different puppet with different `constructor()` args.
       * For example: PuppetA allow `constructor()` but PuppetB requires `constructor(options)`
       *
       * SOLUTION: we enforce all the PuppetImplenmentation to have `options` and should not allow default parameter.
       * Issue: https://github.com/Chatie/wechaty-puppet/issues/2
       */
      return new MyPuppet(options)

    } else if (puppet instanceof Puppet) {
      return puppet
    } else {
      throw new Error('unsupported options.puppet: ' + puppet)
    }
  }

  /**
   * @private
   *
   * Plugin Version Range Check
   */
  private initPuppetSemverSatisfy(versionRange: string) {
    log.verbose('Wechaty', 'initPuppetSemverSatisfy(%s)', versionRange)
    return semver.satisfies(
      this.version(true),
      versionRange,
    )
  }

  protected initPuppetEventBridge(puppet: Puppet) {
    const eventNameList: PuppetEventName[] = Object.keys(PUPPET_EVENT_DICT) as any
    for (const eventName of eventNameList) {
      log.verbose('Wechaty', 'initPuppetEventBridge() puppet.on(%s) registered', eventName)

      switch (eventName) {
        case 'dong':
          puppet.removeAllListeners('dong')
          puppet.on('dong', data => {
            this.emit('dong', data)
          })
          break

        case 'error':
          puppet.removeAllListeners('error')
          puppet.on('error', error => {
            this.emit('error', new Error(error))
          })
          break

        case 'watchdog':
          puppet.removeAllListeners('heartbeat')
          puppet.on('watchdog', data => {
            /**
             * Use `watchdog` event from Puppet to `heartbeat` Wechaty.
             */
            // TODO: use a throttle queue to prevent beat too fast.
            this.emit('heartbeat', data)
          })
          break

        case 'start':
        case 'stop':
          // do not emit 'start'/'stop' again for wechaty:
          // because both puppet & wechaty should have their own
          // `start`/`stop` event seprately
          break

        // case 'start':
        //   puppet.removeAllListeners('start')
        //   puppet.on('start', () => {
        //     this.emit('start')
        //   } )
        //   break

        // case 'stop':
        //   puppet.removeAllListeners('stop')
        //   puppet.on('stop', () => {
        //     this.emit('stop')
        //   } )
        //   break

        case 'friendship':
          puppet.removeAllListeners('friendship')
          puppet.on('friendship', async friendshipId => {
            const friendship = this.Friendship.load(friendshipId)
            await friendship.ready()
            this.emit('friendship', friendship)
            friendship.contact().emit('friendship', friendship)

            // support deprecated event name: friend.
            // Huan LI 201806
            this.emit('friend' as any, friendship as any)
          })
          break

        case 'login':
          puppet.removeAllListeners('login')
          puppet.on('login', async contactId => {
            const contact = this.ContactSelf.load(contactId)
            await contact.ready()
            this.emit('login', contact)
          })
          break

        case 'logout':
          puppet.removeAllListeners('logout')
          puppet.on('logout', async contactId => {
            const contact = this.ContactSelf.load(contactId)
            await contact.ready()
            this.emit('logout', contact)
          })
          break

        case 'message':
          puppet.removeAllListeners('message')
          puppet.on('message', async messageId => {
            const msg = this.Message.create(messageId)
            await msg.ready()
            this.emit('message', msg)
          })
          break

        case 'room-join':
          puppet.removeAllListeners('room-join')
          puppet.on('room-join', async (roomId, inviteeIdList, inviterId) => {
            const room = this.Room.load(roomId)
            await room.ready()

            const inviteeList = inviteeIdList.map(id => this.Contact.load(id))
            await Promise.all(inviteeList.map(c => c.ready()))

            const inviter = this.Contact.load(inviterId)
            await inviter.ready()

            this.emit('room-join', room, inviteeList, inviter)
            room.emit('join', inviteeList, inviter)
          })
          break

        case 'room-leave':
          puppet.removeAllListeners('room-leave')
          puppet.on('room-leave', async (roomId, leaverIdList, removerId) => {
            const room = this.Room.load(roomId)
            await room.ready()

            const leaverList = leaverIdList.map(id => this.Contact.load(id))
            await Promise.all(leaverList.map(c => c.ready()))

            let remover: undefined | Contact = undefined
            if (removerId) {
              remover = this.Contact.load(removerId)
              await remover.ready()
            }

            this.emit('room-leave', room, leaverList, remover)
            room.emit('leave', leaverList, remover)
          })
          break

        case 'room-topic':
          puppet.removeAllListeners('room-topic')
          puppet.on('room-topic', async (roomId, newTopic, oldTopic, changerId) => {
            const room = this.Room.load(roomId)
            await room.ready()

            const changer = this.Contact.load(changerId)
            await changer.ready()

            this.emit('room-topic', room, newTopic, oldTopic, changer)
            room.emit('topic', newTopic, oldTopic, changer)
          })
          break

        case 'scan':
          puppet.removeAllListeners('scan')
          puppet.on('scan', async (qrcode, status, data) => {
            this.emit('scan', qrcode, status, data)
          })
          break

        case 'watchdog':
        case 'reset':
          break

        default:
          throw new Error('eventName ' + eventName + ' unsupported!')

      }
    }
  }

  protected initPuppetAccessory(puppet: Puppet) {
    log.verbose('Wechaty', 'initAccessory(%s)', puppet)

    /**
     * 1. Set Wechaty
     */
    this.Contact.wechaty     = this
    this.ContactSelf.wechaty = this
    this.Friendship.wechaty  = this
    this.Message.wechaty     = this
    this.Room.wechaty        = this

    /**
     * 2. Set Puppet
     */
    this.Contact.puppet     = puppet
    this.ContactSelf.puppet = puppet
    this.Friendship.puppet  = puppet
    this.Message.puppet     = puppet
    this.Room.puppet        = puppet

    this.puppet               = puppet
  }

  /**
   * @private
   * @deprecated use start() instead
   */
  public async init(): Promise<void> {
    log.warn('Wechaty', 'init() DEPRECATED. use start() instead.')
    return this.start()
  }
  /**
   * Start the bot, return Promise.
   *
   * @returns {Promise<void>}
   * @example
   * await bot.start()
   * // do other stuff with bot here
   */
  public async start(): Promise<void> {
    log.info('Wechaty', 'start() v%s is starting...' , this.version())
    log.verbose('Wechaty', 'puppet: %s'   , this.options.puppet)
    log.verbose('Wechaty', 'profile: %s'  , this.options.profile)
    log.verbose('Wechaty', 'id: %s'       , this.id)

    if (this.state.on()) {
      log.silly('Wechaty', 'start() on a starting/started instance')
      await this.state.ready('on')
      log.silly('Wechaty', 'start() state.ready() resolved')
      return
    }

    if (this.lifeTimer) {
      throw new Error('start() lifeTimer exist')
    }

    this.state.on('pending')

    try {
      await this.memory.load()

      this.initPuppet()
      await this.puppet.start()

      if (this.options.ioToken) {
        this.io = new Io({
          token   : this.options.ioToken,
          wechaty : this,
        })
        await this.io.start()
      }

    } catch (e) {
      console.error(e)
      log.error('Wechaty', 'start() exception: %s', e && e.message)
      Raven.captureException(e)
      this.emit('error', e)

      try {
        await this.stop()
      } catch (e) {
        log.error('Wechaty', 'start() stop() exception: %s', e && e.message)
        Raven.captureException(e)
        this.emit('error', e)
      } finally {
        return
      }
    }

    this.on('heartbeat', () => this.memoryCheck())

    this.lifeTimer = setInterval(() => {
      log.silly('Wechaty', 'start() setInterval() this timer is to keep Wechaty running...')
    }, 1000 * 60 * 60)

    this.state.on(true)
    this.emit('start')

    return
  }

  /**
   * Stop the bot
   *
   * @returns {Promise<void>}
   * @example
   * await bot.stop()
   */
  public async stop(): Promise<void> {
    log.info('Wechaty', 'stop() v%s is stoping ...' , this.version())

    if (this.state.off()) {
      log.silly('Wechaty', 'stop() on an stopping/stopped instance')
      await this.state.ready('off')
      log.silly('Wechaty', 'stop() state.ready(off) resolved')
      return
    }

    this.state.off('pending')
    await this.memory.save()

    if (this.lifeTimer) {
      clearInterval(this.lifeTimer)
      this.lifeTimer = undefined
    }

    try {
      await this.puppet.stop()

      if (this.io) {
        await this.io.stop()
        this.io = undefined
      }

    } catch (e) {
      log.error('Wechaty', 'stop() exception: %s', e.message)
      Raven.captureException(e)
      this.emit('error', e)
    }

    this.state.off(true)
    this.emit('stop')

    /**
     * MUST use setImmediate at here(the end of this function),
     * because we need to run the micro task registered by the `emit` method
     */
    setImmediate(() => this.puppet.removeAllListeners())

    return
  }

  /**
   * Logout the bot
   *
   * @returns {Promise<void>}
   * @example
   * await bot.logout()
   */
  public async logout(): Promise<void>  {
    log.verbose('Wechaty', 'logout()')

    try {
      await this.puppet.logout()
    } catch (e) {
      log.error('Wechaty', 'logout() exception: %s', e.message)
      Raven.captureException(e)
      throw e
    }
    return
  }

  /**
   * Get the logon / logoff state
   *
   * @returns {boolean}
   * @example
   * if (bot.logonoff()) {
   *   console.log('Bot logined')
   * } else {
   *   console.log('Bot not logined')
   * }
   */
  public logonoff(): Boolean {
    return this.puppet.logonoff()
  }

  /**
   * @deprecated
   */
  public self(): Contact {
    log.warn('Wechaty', 'self() DEPRECATED. use userSelf() instead.')
    return this.userSelf()
  }

  /**
   * Get current user
   *
   * @returns {Contact}
   * @example
   * const contact = bot.userSelf()
   * console.log(`Bot is ${contact.name()}`)
   */
  public userSelf(): Contact {
    const userId = this.puppet.selfId()
    const user = this.ContactSelf.load(userId)
    return user
  }

  /**
   * Send message to userSelf
   *
   * @param {string} textOrContactOrFile
   * @returns {Promise<boolean>}
   */
  public async say(textOrContactOrFile: string | Contact | FileBox): Promise<void> {
    log.verbose('Wechaty', 'say(%s)', textOrContactOrFile)

    // Make Typescript Happy:
    if (typeof textOrContactOrFile === 'string') {
      await this.userSelf().say(textOrContactOrFile)
    } else if (textOrContactOrFile instanceof Contact) {
      await this.userSelf().say(textOrContactOrFile)
    } else if (textOrContactOrFile instanceof FileBox) {
      await this.userSelf().say(textOrContactOrFile)
    } else {
      throw new Error('unsupported')
    }
  }

  /**
   * @private
   */
  public static async sleep(millisecond: number): Promise<void> {
    await new Promise(resolve => {
      setTimeout(resolve, millisecond)
    })
  }

  /**
   * @private
   */
  public ding(data?: string): void {
    log.silly('Wechaty', 'ding(%s)', data || '')

    try {
      this.puppet.ding(data)
    } catch (e) {
      log.error('Wechaty', 'ding() exception: %s', e.message)
      Raven.captureException(e)
      throw e
    }
  }

  /**
   * @private
   */
  private memoryCheck(minMegabyte = 4): void {
    const freeMegabyte = Math.floor(os.freemem() / 1024 / 1024)
    log.silly('Wechaty', 'memoryCheck() free: %d MB, require: %d MB',
                          freeMegabyte, minMegabyte)

    if (freeMegabyte < minMegabyte) {
      const e = new Error(`memory not enough: free ${freeMegabyte} < require ${minMegabyte} MB`)
      log.warn('Wechaty', 'memoryCheck() %s', e.message)
      this.emit('error', e)
    }
  }

  /**
   * @private
   */
  public async reset(reason?: string): Promise<void> {
    log.verbose('Wechaty', 'reset() because %s', reason || 'no reason')
    await this.puppet.stop()
    await this.puppet.start()
    return
  }

  public unref(): void {
    log.warn('Wechaty', 'unref() To Be Implemented. See: https://github.com/Chatie/wechaty/issues/1197')
  }
}

export default Wechaty
