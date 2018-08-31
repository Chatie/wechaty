#!/usr/bin/env ts-node

import { Wechaty }    from 'wechaty'

function getBotList () {
  return [
    new Wechaty({ puppet: 'wechaty-puppet-mock' }),
    new Wechaty({ puppet: 'wechaty-puppet-wechat4u' }),
    new Wechaty({ puppet: 'wechaty-puppet-puppeteer' }),
    new Wechaty({
      puppet: 'wechaty-puppet-padchat',
      // we use WECHATY_PUPPET_PADCHAT_TOKEN environment variable at here.
    }),
  ]
}

async function main () {
  const botList = getBotList()
  try {
    await Promise.all(
      botList.map(bot => bot.start()),
    )
    botList.forEach(
      bot => console.log(`Wechaty v${bot.version()} smoking test passed.`),
    )
  } catch (e) {
    console.error(e)
    // Error!
    return 1
  } finally {
    await Promise.all(
      botList.map(bot => bot.stop()),
    )
  }
  return 0
}

main()
.then(process.exit)
.catch(e => {
  console.error(e)
  process.exit(1)
})
