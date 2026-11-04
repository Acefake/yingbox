import { app } from 'electron'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { atomicWrite } from './file-operations'

/** 随进程加载，在 mpv 自身的同步 on_load 钩子内清理影盒滤镜，不依赖 IPC 事件的到达时序。 */
export const VSR_LOAD_HOOK = String.raw`
local mp = require('mp')
local pending = {}
local serial = 0
local function clear_filter()
    local filters = mp.get_property_native('vf', {})
    for _, filter in ipairs(filters) do
        if filter.label == 'yingbox-vsr' then
            local ok = mp.commandv('vf', 'remove', '@yingbox-vsr')
            if not ok then mp.commandv('stop') end
            break
        end
    end
end
local function finish(id, abort)
    local entry = pending[id]
    if not entry then return end
    pending[id] = nil
    entry.timer:kill()
    if abort then mp.commandv('stop') end
    clear_filter()
    entry.hook:cont()
end
mp.register_script_message('yingbox-vsr-continue', function(id) finish(id, false) end)
mp.add_hook('on_load', 50, function(hook)
    if not mp.get_property_native('user-data/yingbox-vsr-controlled', false) then
        clear_filter()
        return
    end
    hook:defer()
    serial = serial + 1
    local id = tostring(serial)
    pending[id] = {hook = hook, timer = mp.add_timeout(10, function() finish(id, true) end)}
    mp.commandv('script-message', 'yingbox-vsr-load', id, mp.get_script_name())
end)
mp.set_property_native('user-data/yingbox-vsr-hook', 'ready')

local badge = mp.create_osd_overlay('ass-events')
local badge_loaded = false
local badge_until = 0
local badge_timer
local function source_badge()
    if not badge_loaded then badge:remove(); return end
    local labels = {}
    local enhance = mp.get_property('user-data/yingbox-enhance', '')
    if enhance ~= '' then labels[#labels + 1] = '✧ ' .. enhance end
    local params = mp.get_property_native('video-dec-params', {})
    local width, height = params.w, params.h
    if type(width) == 'number' and type(height) == 'number' and width > 0 and height > 0 then
        local resolution = width >= 7600 and '8K' or width >= 3800 and '4K'
            or width >= 2500 and '1440p' or width >= 1900 and '1080p'
            or width >= 1260 and '720p' or string.format('%dp', height)
        labels[#labels + 1] = resolution
    end
    local video = mp.get_property_native('current-tracks/video', {})
    local profile = video['dolby-vision-profile']
    if type(profile) == 'number' and profile >= 0 and profile <= 10 then
        labels[#labels + 1] = 'DOLBY VISION P' .. tostring(profile)
    elseif params.colormatrix == 'dolbyvision' then
        labels[#labels + 1] = 'DOLBY VISION'
    elseif params.gamma == 'pq' then
        labels[#labels + 1] = 'HDR10'
    elseif params.gamma == 'hlg' then
        labels[#labels + 1] = 'HLG'
    end
    local audio = mp.get_property_native('current-tracks/audio', {})
    local codecs = { ac3 = 'AC3', eac3 = 'EAC3', dts = 'DTS', truehd = 'TrueHD' }
    if codecs[audio.codec] then labels[#labels + 1] = codecs[audio.codec] end
    mp.set_property_native('user-data/yingbox-source-specs', labels)
    local width_osd, height_osd = mp.get_osd_size()
    if #labels == 0 or width_osd <= 0 or height_osd <= 0
        or (mp.get_time() >= badge_until and not mp.get_property_native('pause', false)) then
        badge:remove()
        return
    end
    badge.res_x, badge.res_y = width_osd, height_osd
    local font_size = math.max(14, math.floor(height_osd / 48))
    badge.data = string.format('{\\an9\\pos(%d,%d)\\fs%d\\bord1\\shad0}%s',
        width_osd - font_size, font_size, font_size, table.concat(labels, '   '))
    badge:update()
end
local function reveal_badge()
    badge_until = mp.get_time() + 4
    if badge_timer then badge_timer:kill() end
    badge_timer = mp.add_timeout(4, source_badge)
    source_badge()
end
mp.register_event('file-loaded', function() badge_loaded = true; reveal_badge() end)
mp.register_event('end-file', function()
    badge_loaded = false
    badge_until = 0
    badge:remove()
    mp.set_property_native('user-data/yingbox-source-specs', {})
end)
mp.observe_property('video-dec-params', 'native', source_badge)
mp.observe_property('track-list', 'native', source_badge)
mp.observe_property('osd-dimensions', 'native', source_badge)
mp.observe_property('pause', 'bool', reveal_badge)
mp.observe_property('user-data/yingbox-enhance', 'string', source_badge)
local enhance_button = mp.create_osd_overlay('ass-events')
local enhance_hover = false
mp.register_event('end-file', function()
    enhance_button:remove()
    mp.remove_key_binding('yingbox-enhance-click')
    enhance_hover = false
end)
local function draw_enhance_button()
    local w, h = mp.get_osd_size()
    if not badge_loaded or (mp.get_time() >= badge_until and not mp.get_property_native('pause', false)) then
        enhance_button:remove()
        return
    end
    enhance_button.res_x, enhance_button.res_y = w, h
    enhance_button.data = string.format('{\\an5\\pos(%d,%d)\\fs28\\bord1}✧', w - 48, h - 96)
    enhance_button:update()
end
mp.add_periodic_timer(0.5, draw_enhance_button)
mp.observe_property('mouse-pos', 'native', function(_, position)
    if position and position.hover then reveal_badge() end
    local w, h = mp.get_osd_size()
    local over = badge_loaded and position and position.hover and math.abs(position.x - (w - 48)) <= 24 and math.abs(position.y - (h - 96)) <= 24
    if over and not enhance_hover then
        mp.add_forced_key_binding('MBTN_LEFT', 'yingbox-enhance-click', function()
            mp.commandv('script-message', 'yingbox-enhance-toggle')
        end)
    elseif not over and enhance_hover then
        mp.remove_key_binding('yingbox-enhance-click')
    end
    enhance_hover = over
end)
`

/** 写入运行时资源；失败只禁用增强，不阻止普通播放。 */
export async function ensureMpvVsrHook(): Promise<string | null> {
  try {
    const path = join(app.getPath('userData'), 'runtime', 'mpv-vsr-hook.lua')
    await mkdir(dirname(path), { recursive: true })
    await atomicWrite(path, VSR_LOAD_HOOK)
    return path
  } catch (error) {
    console.warn('[mpv] 无法准备超分换片保护：', error)
    return null
  }
}
