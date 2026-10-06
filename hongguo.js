const cheerio = createCheerio()

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

let appConfig = {
  ver: 1,
  title: '红果短剧',
  site: 'https://hongguoduanju.com',
}

function headers() {
  return {
    'User-Agent': UA,
    'Referer': appConfig.site + '/',
  }
}

// 反转义直链：\u002F -> /，\u0026 -> &，去掉 Range 参数
function unescapeUrl(s) {
  return String(s || '')
    .replace(/\\u002F/g, '/')
    .replace(/\\u0026/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/([?&])Range=[^&]*/gi, '$1')
    .replace(/[?&]$/, '')
}

// 解析剧集卡片（分类页 / 榜单页 / 搜索页通用）
// 卡片结构：a[href="/detail?series_id=xxx"] > img[alt=剧名] + 全xx集 + 标签
// 注意：站点 class 名带哈希后缀，解析只用 href / img alt 等稳定属性
function parseCards($) {
  const cards = []
  const seen = new Set()
  $('a[href^="/detail?series_id="]').each((_, el) => {
    const $a = $(el)
    const m = ($a.attr('href') || '').match(/series_id=(\d+)/)
    if (!m) return
    const sid = m[1]
    if (seen.has(sid)) return
    seen.add(sid)
    const img = $a.find('img[alt!=""]').first()
    const title = (img.attr('alt') || '').trim()
    if (!title) return
    const cover = img.attr('src') || ''
    const ep = ($a.text().match(/全\d+集/) || [''])[0]
    cards.push({
      vod_id: sid,
      vod_name: title,
      vod_pic: cover,
      vod_remarks: ep,
      ext: { series_id: sid },
    })
  })
  return cards
}

async function getConfig() {
  let config = appConfig
  config.tabs = [
    { name: '热播榜', ext: { url: `${appConfig.site}/rank/hot-drama` } },
    { name: '真人短剧', ext: { url: `${appConfig.site}/category/real-drama` } },
    { name: 'AI短剧', ext: { url: `${appConfig.site}/category/ai-drama` } },
    { name: '热门漫剧', ext: { url: `${appConfig.site}/category/comic-drama` } },
    { name: '漫画', ext: { url: `${appConfig.site}/category/comic` } },
  ]
  return jsonify(config)
}

async function getCards(ext) {
  ext = argsify(ext)
  let { page = 1, url } = ext
  if (page > 1) url += (url.includes('?') ? '&' : '?') + 'page=' + page
  const { data } = await $fetch.get(url, { headers: headers() })
  const $ = cheerio.load(data)
  return jsonify({ list: parseCards($) })
}

async function getTracks(ext) {
  ext = argsify(ext)
  const sid = ext.series_id
  const url = `${appConfig.site}/player/${sid}`
  const { data } = await $fetch.get(url, { headers: headers() })
  const tracks = []
  // 主路：内嵌 JSON 的 vid_list（下标即集数顺序）
  const m = data.match(/"vid_list"\s*:\s*\[([^\]]*)\]/)
  if (m) {
    const vids = [...m[1].matchAll(/"(\d+)"/g)].map((x) => x[1])
    vids.forEach((vid, i) => {
      tracks.push({ name: `第${i + 1}集`, pan: '', ext: { sid, vid } })
    })
  }
  // 兜底：vid_list 取不到时，从选集链接 /player/{sid}/{vid} 反提 vid
  if (tracks.length === 0) {
    const seen = new Set()
    const linkVids = [...data.matchAll(/\/player\/\d+\/(\d+)/g)]
      .map((x) => x[1])
      .filter((v) => !seen.has(v) && (seen.add(v), true))
    linkVids.forEach((vid, i) => {
      tracks.push({ name: `第${i + 1}集`, pan: '', ext: { sid, vid } })
    })
  }
  const title = (data.match(/"series_name"\s*:\s*"([^"]*)"/) || [])[1] || ''
  return jsonify({ list: [{ title: title || '选集', tracks }] })
}

async function getPlayinfo(ext) {
  ext = argsify(ext)
  const { sid, vid } = ext
  const url = `${appConfig.site}/player/${sid}/${vid}`
  const { data } = await $fetch.get(url, { headers: headers() })
  let playUrl = ''
  let m = data.match(/"main_url"\s*:\s*"([^"]+)"/)
  if (m) playUrl = unescapeUrl(m[1])
  if (!playUrl) {
    m = data.match(/"contentUrl"\s*:\s*"([^"]+)"/)
    if (m) playUrl = unescapeUrl(m[1])
  }
  if (!playUrl || !/^https?:\/\//i.test(playUrl)) return jsonify({ urls: [] })
  return jsonify({ urls: [playUrl], headers: [{ Referer: appConfig.site + '/' }] })
}

async function search(ext) {
  ext = argsify(ext)
  const keyword = encodeURIComponent(ext.text)
  const url = `${appConfig.site}/search/${keyword}`
  const { data } = await $fetch.get(url, { headers: headers() })
  const $ = cheerio.load(data)
  return jsonify({ list: parseCards($) })
}
