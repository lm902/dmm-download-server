const JSZip = require('jszip')
const fetch = require('node-fetch')
const JSDOM = require('jsdom').JSDOM
const config = require('./config.json')

const window = new JSDOM().window
const document = window.document

module.exports = async ids => {
  const playlistPromises = []
  const playlists = []
  for (const id of ids) {
    const promise = (async () => {
      let info = {
        product_id: id
      }
      {
        const response = await fetch('https://www.dmm.co.jp/service/digitalapi/-/html5/', {
          body: JSON.stringify(
            {
              action: 'playlist',
              format: 'json',
              service: 'monthly',
              shop_name: 'premium',
              ...info
            }),
          method: 'post',
          headers: {
            'content-type': 'application/json',
            'cookie': config.cookie
          }
        })
        const json = await response.json()
        for (let item of json.list.item) {
          playlists.push(item)
        }
      }
    })().catch(e => console.error(e))
    playlistPromises.push(promise)
  }
  await Promise.all(playlistPromises)
  const playinfoPromises = []
  const playinfos = []
  for (const playlist of playlists) {
    const promise = (async () => {
      const response = await fetch('https://www.dmm.co.jp/service/digitalapi/-/html5/', {
        body: JSON.stringify(
          {
            action: 'playinfo',
            format: 'json',
            service: 'monthly',
            ...playlist
          }),
        method: 'post',
        headers: {
          'content-type': 'application/json',
          'cookie': config.cookie
        }
      })
      const json = await response.json()
      const playinfo = {
        cid: json.list.cid,
        url: json.list.item.filter(x => x.bitrate === '0')[0].url,
        ...playlist
      }
      try {
        const response = await fetch(playinfo.url.replace(/\/\/.+?\?/, '//www.dmm.co.jp/service/-/drm_iphone?'), {
          headers: {
            'cookie': config.cookie,
            'accept': '*/*'
          }
        })
        playinfo.keyBlob = await response.buffer()
        playinfo.key = playinfo.keyBlob
      } catch (e) {
        console.error(e)
      }
      playinfos.push(playinfo)
    })().catch(e => console.error(e))
    playinfoPromises.push(promise)
  }
  await Promise.all(playinfoPromises)
  const zip = new JSZip()
  const filePromises = []
  for (const playinfo of playinfos) {
    const folder = zip.folder(playinfo.cid)
    const keyBlob = playinfo.keyBlob
    delete playinfo.keyBlob
    folder.file(`${playinfo.part}.json`, JSON.stringify(playinfo, null, 2))
    filePromises.push((async () => {
      const path = playinfo.url.substring(0, playinfo.url.lastIndexOf('/') + 1).replace(/http:\/\/str.dmm.com:80/g, 'https://str.dmm.com')
      let link
      {
        const response = await fetch(playinfo.url)
        const text = await response.text()
        const bitrates = text.split('#EXT-X-STREAM-INF:BANDWIDTH=')
        let max = 0
        for (const bitrate of bitrates) {
          const b = bitrate.split('\n')[0]
          if (b > max) {
            max = b
            link = bitrate.split('\n')[1]
          }
        }
      }
      link = path + link
      const response = await fetch(link)
      const text = await response.text()
      let playlist = text.replace(/media/g, path + 'media')
      playlist = playlist.replace(/#EXT-X-KEY:METHOD=AES-128,URI=".+?"/, `#EXT-X-KEY:METHOD=AES-128,URI="key.bin"`)
      folder.file(`${playinfo.part}.m3u8`, playlist)
      if (playinfo.part <= 1) {
        folder.file(`key.bin`, keyBlob)
      }
    })().catch(e => console.error(e)))
    filePromises.push((async () => {
      if (playinfo.part > 1) {
        return
      }
      const response = await fetch(`http://www.dmm.co.jp/digital/videoa/-/detail/=/cid=${playinfo.cid}/`)
      const text = await response.text()
      const template = document.createElement('template')
      template.innerHTML = text
      window.t = template
      const title = template.content.querySelector('title').textContent
      if (title.includes('このページはお住まいの地域からご利用になれません')) {
        throw new Error('由于地域限制无法访问详细信息页。')
      } else if (title.includes('指定されたページが見つかりません')) {
        throw new Error('页面不存在。')
      }
      try {
        const rows = template.content.querySelectorAll('table.mg-b20 tr')
        const nodes = [...rows].map(row => row.children)
        const infoPairs = nodes.filter(node => node.length).map(node => {
          try {
            return [node[0].textContent.replace('：', ''), node[1].textContent]
          } catch (e) {
            return []
          }
        })
        const lines = ['key,value']
        lines.push('title,' + template.content.getElementById('title').textContent)
        for (let infoPair of infoPairs) {
          const line = infoPair.map(value => value.replace(/\n/g, '').trim()).join()
          if (line.length > 1) {
            lines.push(line)
          }
        }
        folder.file('info.csv', lines.join('\n'))
      } catch (e) {
        console.error(e)
      }
      folder.file('cover.url', '[InternetShortcut]\nURL=' + template.content.getElementById(playinfo.cid).href)
    })().catch(e => console.error(e)))
  }
  await Promise.all(filePromises)
  return zip.generateAsync({
    type: 'nodebuffer'
  })
}
