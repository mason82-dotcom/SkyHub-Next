<!--
  Copyright 2025-2026 DJI. All rights reserved.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
-->

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { useLabLocale } from '@/composables/useLabLocale'
import UserDropdown from './UserDropdown.vue'
import { useChatStore } from '@/stores/chat'
import { useChatAvailability } from '@/composables/useChatAvailability'
import { usePaasAvailability } from '@/composables/usePaasAvailability'
import { formatPaasShortHint } from '@/utils/paasMessages'
import {
  LayoutDashboard,
  Cpu,
  Gamepad2,
  Route,
  PlayCircle,
  Camera,
  Globe,
  Box,
  MonitorPlay,
} from 'lucide-vue-next'
import type { Component } from 'vue'

interface NavItem {
  path: string
  label: string
  icon: Component
  /** 该入口依赖 FH2 底座（paas.js / 直播 SDK / 航线编辑器 SDK），底座不可用时置灰 */
  requiresPaas?: boolean
}

const route = useRoute()
const { locale, t, setLocale } = useLabLocale()
function onLocaleChange(e: Event): void {
  setLocale((e.target as HTMLSelectElement).value)
}
const chatStore = useChatStore()

// 探测未完成前不渲染入口，避免后端关掉 AI 助手时按钮闪现后消失
const { available: chatAvailable, probed: chatProbed } = useChatAvailability()

// 底部探测 + 导航置灰共用同一份结果
const { availability: paasAvailability, probed: paasProbed } = usePaasAvailability()

const navItems: NavItem[] = [
  { path: '/', label: 'dashboard', icon: LayoutDashboard },
  { path: '/live-stream', label: 'stream', icon: MonitorPlay, requiresPaas: true },
  { path: '/devices', label: 'devices', icon: Cpu, requiresPaas: true },
  { path: '/cockpit', label: 'cockpit', icon: Gamepad2, requiresPaas: true },
  { path: '/wayline', label: 'wayline', icon: Route, requiresPaas: true },
  { path: '/flight-tasks', label: 'tasks', icon: PlayCircle },
  { path: '/media', label: 'media', icon: Camera },
  { path: '/flight-areas', label: 'airspace', icon: Globe },
  { path: '/models', label: 'models', icon: Box },
]

/**
 * 判断导航项是否因底座不可用而禁用。
 *
 * <p>放在 script 而非模板里，避免模板中堆叠三段条件难以阅读。
 * 探测完成前不置灰：available 初始值为 false，若直接据此判定会让入口
 * 「先灰后亮」闪一下，观感比稍慢一点更差。
 *
 * @param item 导航项
 * @returns true 表示需要置灰且禁止跳转
 */
function isNavItemDisabled(item: NavItem): boolean {
  if (item.requiresPaas !== true) {
    return false
  }
  return paasProbed.value && !paasAvailability.value.available
}

/**
 * 生成禁用导航项的悬浮说明。
 *
 * <p>探测尚未完成时 reason 为 null，此时入口不会置灰（available 默认 false 会让
 * 入口先灰后亮，故仅在探测完成后才判定），因此这里 reason 必定非空。
 *
 * @returns 含不可用原因的一句话提示
 */
function disabledNavHint(): string {
  const { reason, address } = paasAvailability.value
  return reason ? formatPaasShortHint(reason, address) : ''
}
</script>

<template>
  <header class="top-nav">
    <div class="top-nav__logo">
      <img src="@/assets/logo.svg" alt="CloudAPI2" class="logo-text" />
    </div>

    <nav class="top-nav__items">
      <!--
        依赖底座的入口在底座不可用时渲染为 span 而非 router-link：
        灰掉链接但仍可点击/可聚焦会让键盘用户和读屏用户误以为能进。
      -->
      <template v-for="item in navItems" :key="item.path">
        <span
          v-if="isNavItemDisabled(item)"
          class="nav-item nav-item--disabled"
          :title="disabledNavHint()"
          aria-disabled="true"
        >
          <component :is="item.icon" class="nav-icon" :size="16" :stroke-width="1.75" />
          <span>{{ t(item.label) }}</span>
        </span>
        <router-link
          v-else
          :to="item.path"
          class="nav-item"
          :class="{ 'nav-item--active': route.path === item.path }"
        >
          <component :is="item.icon" class="nav-icon" :size="16" :stroke-width="1.75" />
          <span>{{ t(item.label) }}</span>
        </router-link>
      </template>
    </nav>

    <div class="top-nav__actions">
      <label class="lab-locale">
        <span class="lab-locale__sr">{{ t('language') }}</span>
        <select :value="locale" :aria-label="t('language')" @change="onLocaleChange">
          <option value="de">DE</option><option value="en">EN</option>
        </select>
      </label>
      <button
        v-if="chatProbed && chatAvailable"
        class="ai-btn"
        :class="{ 'ai-btn--active': chatStore.isOpen }"
        title="AI 助手 (Ctrl+/)"
        @click="chatStore.toggleDrawer"
      >
        <img src="@/assets/ai-assistant.png" alt="AI 助手" class="ai-btn__icon" />
        <span class="ai-btn__label">AI 助手</span>
      </button>
      <UserDropdown />
    </div>
  </header>
  <div class="lab-banner" role="status" :aria-label="t('mock')"><strong>{{ t('mock') }}</strong><span>{{ t('mockDetail') }}</span></div>
</template>

<style scoped>
.top-nav {
  display: flex;
  align-items: center;
  height: 48px;
  padding: 0 20px;
  background: var(--app-bg-panel);
  border-bottom: 1px solid var(--app-border);
  flex-shrink: 0;
  gap: 8px;
}

.top-nav__logo {
  flex-shrink: 0;
  margin-right: 12px;
}

.logo-text {
  height: 28px;
  width: auto;
  display: block;
  white-space: nowrap;
}

.top-nav__items {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1;
  justify-content: center;
  overflow-x: auto;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 14px;
  height: 48px;
  text-decoration: none;
  color: rgba(255, 255, 255, 0.85);
  font-size: 15px;
  font-weight: 500;
  white-space: nowrap;
  transition: color var(--transition-base);
  position: relative;
  border: none;
  background: none;
}

.nav-item:hover {
  color: #ffffff;
}

.nav-item--disabled {
  color: rgba(255, 255, 255, 0.35);
  cursor: not-allowed;
}

.nav-item--disabled:hover {
  color: rgba(255, 255, 255, 0.35);
}

.nav-item--active {
  color: var(--app-primary-hover);
  font-weight: 600;
}

.nav-item--active::after {
  content: '';
  position: absolute;
  left: 14px;
  right: 14px;
  bottom: 0;
  height: 2px;
  border-radius: 1px 1px 0 0;
  background: var(--app-primary-hover);
}

.nav-item--active .nav-icon {
  color: var(--app-primary-hover);
}

.nav-icon {
  flex-shrink: 0;
  transition: color var(--transition-base);
}

.top-nav__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin-left: 12px;
}

.ai-btn {
  height: 32px;
  padding: 0 10px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: rgba(255, 255, 255, 0.65);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 5px;
  transition: all var(--transition-base);
}

.ai-btn__label {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
}

.ai-btn__icon {
  width: 22px;
  height: 22px;
  border-radius: 50%;
}

.ai-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #ffffff;
}

.ai-btn--active {
  background: rgba(124, 58, 237, 0.12);
  color: #a78bfa;
}
</style>

<style scoped>
.lab-locale select { min-width:54px;min-height:40px;padding:0 6px;color:var(--app-text);background:var(--app-bg-panel);border:1px solid var(--app-border-strong);border-radius:8px;cursor:pointer }
.lab-locale__sr {position:absolute;overflow:hidden;clip:rect(0,0,0,0);height:1px;width:1px}
.lab-banner{display:flex;flex-wrap:wrap;align-items:center;gap:12px;min-height:34px;padding:6px 20px;background:#4c3a1f;color:#ffedc5;border-bottom:1px solid #c28f40;font-size:12px}
.lab-banner strong{font-size:12px;letter-spacing:.04em}
@media(max-width:900px){.top-nav{height:auto;min-height:56px;flex-wrap:wrap;padding:8px 12px;gap:8px}.top-nav__logo{margin-right:auto}.top-nav__items{order:3;flex:0 0 100%;justify-content:flex-start;overflow-x:auto;scrollbar-width:thin;scrollbar-color:var(--app-border-strong) transparent;scrollbar-gutter:stable;min-width:0}.top-nav__actions{margin-left:0;max-width:100%}.nav-item{min-height:44px;height:44px;padding:0 10px}.nav-item--active::after{left:10px;right:10px}.lab-banner{padding:7px 12px}}
@media(max-width:400px){.logo-text{max-width:130px;height:auto}.lab-banner{gap:4px}.lab-banner strong,.lab-banner span{display:block;width:100%}}
</style>
