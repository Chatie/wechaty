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
import { EventEmitter }     from 'events'
import { instanceToClass }  from 'clone-class'

import {
  Wechaty,
}                   from '../wechaty'
import {
  log,
}                   from '../config'
import {
  tryWait,
}                   from '../helper-functions/mod'

import {
  FriendshipAddOptions as PuppetFriendshipAddOptions,
  FriendshipPayload,
  FriendshipType,
  FriendshipSearchQueryFilter,
  FriendshipSource, FriendshipPayloadReceive,
} from 'wechaty-puppet'

import {
  Acceptable,
}                   from '../types'

import {
  Contact,
}                   from './contact'

import {
  Room,
}                   from './room'

interface FriendshipAddOptionsObject {
  room?: Room,
  contact?: Contact,
  hello?: string,
}

type FriendshipAddOptions = string | FriendshipAddOptionsObject

/**
 * Send, receive friend request, and friend confirmation events.
 *
 * 1. send request
 * 2. receive request(in friend event)
 * 3. confirmation friendship(friend event)
 *
 * [Examples/Friend-Bot]{@link https://github.com/wechaty/wechaty/blob/1523c5e02be46ebe2cc172a744b2fbe53351540e/examples/friend-bot.ts}
 */
class Friendship extends EventEmitter implements Acceptable {

  static get wechaty  (): Wechaty { throw new Error('This class can not be used directly. See: https://github.com/wechaty/wechaty/issues/2027') }
  get wechaty        (): Wechaty { throw new Error('This class can not be used directly. See: https://github.com/wechaty/wechaty/issues/2027') }

  public static Type = FriendshipType

  /**
   * @ignore
   */
  public static load<T extends typeof Friendship> (
    this : T,
    id   : string,
  ): T['prototype'] {
    const newFriendship = new (this as any)(id)
    return newFriendship
  }

  /**
   * Search a Friend by phone or weixin.
   *
   * The best practice is to search friend request once per minute.
   * Remember not to do this too frequently, or your account may be blocked.
   *
   * @param {FriendshipSearchCondition} condition - Search friend by phone or weixin.
   * @returns {Promise<Contact>}
   *
   * @example
   * const friend_phone = await bot.Friendship.search({phone: '13112341234'})
   * const friend_weixin = await bot.Friendship.search({weixin: 'weixin_account'})
   *
   * console.log(`This is the new friend info searched by phone : ${friend_phone}`)
   * await bot.Friendship.add(friend_phone, 'hello')
   *
   */
  public static async search (
    queryFilter : FriendshipSearchQueryFilter,
  ): Promise<null | Contact> {
    log.verbose('Friendship', 'static search("%s")',
      JSON.stringify(queryFilter),
    )
    const contactId = await this.wechaty.puppet.friendshipSearch(queryFilter)

    if (!contactId) {
      return null
    }

    const contact = this.wechaty.Contact.load(contactId)
    await contact.ready()
    return contact
  }

  /**
   * Send a Friend Request to a `contact` with message `hello`.
   *
   * The best practice is to send friend request once per minute.
   * Remeber not to do this too frequently, or your account may be blocked.
   *
   * @param {Contact} contact - Send friend request to contact
   * @param {FriendshipAddOptions} options - The friend request content
   * @returns {Promise<void>}
   *
   * @example
   * const contact = await bot.Friendship.search({phone: '13112341234'})
   * await bot.Friendship.add(contact, 'Nice to meet you! I am wechaty bot!')
   *
   * const memberList = await room.memberList()
   * for (let i = 0; i < memberList.length; i++) {
   *   await bot.Friendship.add(member, {
   *     room: room,
   *     hello: `Nice to meet you! I am wechaty bot from room: ${await room.topic()}!`,
   *   })
   * }
   *
   */
  public static async add (
    contact : Contact,
    options  : FriendshipAddOptions,
  ): Promise<void> {
    log.verbose('Friendship', 'static add(%s, %s)',
      contact.id,
      typeof options === 'string' ? options : options.hello,
    )

    if (typeof options === 'string') {
      log.warn('Friendship', 'the params hello is deprecated in the next version, please put the attr hello into options object, e.g. { hello: "xxxx" }')
      await this.wechaty.puppet.friendshipAdd(contact.id, { hello: options })
    } else {
      const friendOption: PuppetFriendshipAddOptions = {
        contactId: options?.contact?.id,
        hello: options.hello,
        roomId: options.room && options.room.id,
      }
      await this.wechaty.puppet.friendshipAdd(contact.id, friendOption)
    }
  }

  public static async del (
    contact: Contact,
  ): Promise<void> {
    log.verbose('Friendship', 'static del(%s)', contact.id)
    throw new Error('to be implemented')
  }

  /**
   *
   * Instance Properties
   *
   */

  /**
    * @ignore
   */
  protected payload?: FriendshipPayload

  /*
   * @hideconstructor
   */
  constructor (
    public readonly id: string,
  ) {
    super()
    log.verbose('Friendship', 'constructor(id=%s)', id)

    const MyClass = instanceToClass(this, Friendship)

    if (MyClass === Friendship) {
      throw new Error('Friendship class can not be instantiated directly! See: https://github.com/wechaty/wechaty/issues/1217')
    }

    if (!this.wechaty.puppet) {
      throw new Error('Friendship class can not be instantiated without a puppet!')
    }
  }

  public override toString () {
    if (!this.payload) {
      return this.constructor.name
    }

    return [
      'Friendship#',
      FriendshipType[this.payload.type],
      '<',
      this.payload.contactId,
      '>',
    ].join('')
  }

  public isReady (): boolean {
    return !!this.payload && (Object.keys(this.payload).length > 0)
  }

  /**
   * no `dirty` support because Friendship has no rawPayload(yet)
    * @ignore
   */
  public async ready (): Promise<void> {
    if (this.isReady()) {
      return
    }

    this.payload = await this.wechaty.puppet.friendshipPayload(this.id)

    if (!this.payload) {
      throw new Error('no payload')
    }

    await this.contact().ready()
  }

  /**
   * Accept Friend Request
   *
   * @returns {Promise<void>}
   *
   * @example
   * const bot = new Wechaty()
   * bot.on('friendship', async friendship => {
   *   try {
   *     console.log(`received friend event.`)
   *     switch (friendship.type()) {
   *
   *     // 1. New Friend Request
   *
   *     case Friendship.Type.Receive:
   *       await friendship.accept()
   *       break
   *
   *     // 2. Friend Ship Confirmed
   *
   *     case Friendship.Type.Confirm:
   *       console.log(`friend ship confirmed`)
   *       break
   *     }
   *   } catch (e) {
   *     console.error(e)
   *   }
   * }
   * .start()
   */
  public async accept (): Promise<void> {
    log.verbose('Friendship', 'accept()')

    if (!this.payload) {
      throw new Error('no payload')
    }

    if (this.payload.type !== Friendship.Type.Receive) {
      throw new Error('accept() need type to be FriendshipType.Receive, but it got a ' + Friendship.Type[this.payload.type])
    }

    log.silly('Friendship', 'accept() to %s', this.payload.contactId)

    await this.wechaty.puppet.friendshipAccept(this.id)

    const contact = this.contact()

    await tryWait(async (retry, attempt) => {
      log.silly('Friendship', 'accept() retry() ready() attempt %d', attempt)

      await contact.ready()

      if (contact.isReady()) {
        log.verbose('Friendship', 'accept() with contact %s ready()', contact.name())
        return
      }
      retry(new Error('Friendship.accept() contact.ready() not ready'))

    }).catch((e: Error) => {
      log.warn('Friendship', 'accept() contact %s not ready because of %s', contact, (e && e.message) || e)
    })

    // try to fix issue #293
    await contact.sync()
  }

  /**
   * Get verify message from
   *
   * @returns {string}
   * @example <caption>If request content is `ding`, then accept the friendship</caption>
   * const bot = new Wechaty()
   * bot.on('friendship', async friendship => {
   *   try {
   *     console.log(`received friend event from ${friendship.contact().name()}`)
   *     if (friendship.type() === Friendship.Type.Receive && friendship.hello() === 'ding') {
   *       await friendship.accept()
   *     }
   *   } catch (e) {
   *     console.error(e)
   *   }
   * }
   * .start()
   */
  public hello (): string {
    if (!this.payload) {
      throw new Error('no payload')
    }
    return this.payload.hello || ''
  }

  /**
   * Get the contact from friendship
   *
   * @returns {Contact}
   * @example
   * const bot = new Wechaty()
   * bot.on('friendship', async friendship => {
   *   const contact = friendship.contact()
   *   const name = contact.name()
   *   console.log(`received friend event from ${name}`)
   * }
   * .start()
   */
  public contact (): Contact {
    if (!this.payload) {
      throw new Error('no payload')
    }

    const contact = this.wechaty.Contact.load(this.payload.contactId)
    return contact
  }

  /**
   * Return the Friendship Type
   * > Tips: FriendshipType is enum here. </br>
   * - FriendshipType.Unknown  </br>
   * - FriendshipType.Confirm  </br>
   * - FriendshipType.Receive  </br>
   * - FriendshipType.Verify   </br>
   *
   * @returns {FriendshipType}
   *
   * @example <caption>If request content is `ding`, then accept the friendship</caption>
   * const bot = new Wechaty()
   * bot.on('friendship', async friendship => {
   *   try {
   *     if (friendship.type() === Friendship.Type.Receive && friendship.hello() === 'ding') {
   *       await friendship.accept()
   *     }
   *   } catch (e) {
   *     console.error(e)
   *   }
   * }
   * .start()
   */
  public type (): FriendshipType {
    return this.payload
      ? this.payload.type
      : FriendshipType.Unknown
  }

  /**
   * Return FriendshipSource in FriendshipPayloadReceive
   * Issue #2120: https://github.com/wechaty/wechaty/pull/2120
   * Ref Issue #1801: https://github.com/wechaty/wechaty/issues/1801
   * @author https://github.com/suhli
   * @returns {FriendshipSource}
   * @example
   * const bot = new Wechaty()
   * bot.on('friendship', async friendship => {
   * if (friendship.type() === Friendship.Type.Receive) {
   *       console.log(JSON.stringify(friendship.source(),null,2))
   *   }
   * }
   * .start()
   **/
  public source (): FriendshipSource | null {
    return (this.payload as FriendshipPayloadReceive).source || null
  }

  /**
   * get friendShipPayload Json
   * @returns {FriendshipPayload}
   *
   * @example
   * const bot = new Wechaty()
   * bot.on('friendship', async friendship => {
   *   try {
   *     // JSON.stringify(friendship) as well.
   *     const payload = await friendship.toJSON()
   *   } catch (e) {
   *     console.error(e)
   *   }
   * }
   * .start()
   */
  public toJSON (): string {
    log.verbose('Friendship', 'toJSON()')

    if (!this.isReady()) {
      throw new Error(`Friendship<${this.id}> needs to be ready. Please call ready() before toJSON()`)
    }
    return JSON.stringify(this.payload)
  }

  /**
   * create friendShip by friendshipJson
   * @example
   * const bot = new Wechaty()
   * bot.start()
   *
   * const payload = '{...}'  // your saved JSON payload
   * const friendship = bot.FriendShip.fromJSON(friendshipFromDisk)
   * await friendship.accept()
   */
  public static async fromJSON (
    payload: string | FriendshipPayload,
  ): Promise<Friendship> {
    log.verbose('Friendship', 'static fromJSON(%s)',
      typeof payload === 'string'
        ? payload
        : JSON.stringify(payload),
    )

    if (typeof payload === 'string') {
      payload = JSON.parse(payload) as FriendshipPayload
    }

    /**
     * Set the payload back to the puppet for future use
     */
    await this.wechaty.puppet.friendshipPayload(payload.id, payload)

    const instance = this.wechaty.Friendship.load(payload.id)
    await instance.ready()

    return instance
  }

}

function wechatifyFriendship (wechaty: Wechaty): typeof Friendship {

  class WechatifiedFriendship extends Friendship {

    static override get wechaty  () { return wechaty }
    override get wechaty        () { return wechaty }

  }

  return WechatifiedFriendship

}

export {
  Friendship,
  wechatifyFriendship,
}
