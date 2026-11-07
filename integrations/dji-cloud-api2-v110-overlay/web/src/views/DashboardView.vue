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
import { ref, onMounted } from 'vue'
import { useLabLocale } from '@/composables/useLabLocale'
import type { DashboardStats, TimeRange } from '@/types/dashboard'
import { fetchDashboardStats } from '@/api/dashboard'
import AssetPanel from '@/components/dashboard/AssetPanel.vue'
import DeviceMap from '@/components/dashboard/DeviceMap.vue'
import TaskPanel from '@/components/dashboard/TaskPanel.vue'
import TimeRangeSelector from '@/components/dashboard/TimeRangeSelector.vue'

const { t } = useLabLocale()
const stats = ref<DashboardStats | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const timeRange = ref<TimeRange>('month')

async function loadStats(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    stats.value = await fetchDashboardStats(timeRange.value)
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : t('loadError')
  } finally {
    loading.value = false
  }
}

function handleRangeChange(range: TimeRange): void {
  timeRange.value = range
  loadStats()
}

onMounted(() => {
  loadStats()
})
</script>

<template>
  <div class="dashboard-layout">
    <p class="dashboard-layout__provenance">{{ t('noLive') }}</p>
    <aside class="dashboard-layout__left">
      <AssetPanel v-if="stats" :stats="stats" />
    </aside>

    <main class="dashboard-layout__center">
      <TimeRangeSelector
        :model-value="timeRange"
        class="dashboard-layout__time-selector"
        @update:model-value="handleRangeChange"
      />
      <DeviceMap v-if="stats" :devices="stats.devices" />
      <div v-if="loading" class="dashboard-layout__loading">{{ t('loading') }}</div>
      <div v-if="error" class="dashboard-layout__error">{{ error }}</div>
    </main>

    <aside class="dashboard-layout__right">
      <TaskPanel v-if="stats" :stats="stats" />
    </aside>
  </div>
</template>

<style scoped>
.dashboard-layout {
  display: flex;
  height: 100%;
  min-height: 0;
  width: 100%;
  overflow: hidden;
  background: var(--app-bg);
}

.dashboard-layout__left,
.dashboard-layout__right {
  flex-shrink: 0;
  overflow-y: auto;
  background: var(--app-bg-panel);
  border-right: 1px solid var(--app-border);
  padding: 16px;
}

.dashboard-layout__left {
  width: 320px;
}

.dashboard-layout__right {
  width: 360px;
  border-right: none;
  border-left: 1px solid var(--app-border);
}

.dashboard-layout__center {
  flex: 1;
  position: relative;
  min-width: 0;
}

.dashboard-layout__time-selector {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
}

.dashboard-layout__loading,
.dashboard-layout__error {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: var(--app-text-muted);
  font-size: 14px;
}

.dashboard-layout__error {
  color: var(--app-danger);
}
</style>

<style scoped>
.dashboard-layout{position:relative}\n.dashboard-layout__provenance{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);z-index:12;margin:0;background:rgba(54,42,24,.96);border:1px solid #b78d45;border-radius:7px;padding:8px 12px;font-size:12px;font-weight:650;color:#ffebbe;pointer-events:none;max-width:92%;text-align:center}
@media(max-width:900px){.dashboard-layout{height:auto;min-height:100%;display:flex;flex-direction:column;overflow:visible}.dashboard-layout__center{order:1;flex:none;height:380px;min-height:380px;overflow:hidden}.dashboard-layout__left{order:2}.dashboard-layout__right{order:3}.dashboard-layout__left,.dashboard-layout__right{width:100%;max-width:100%;flex:none;overflow:visible;border:0;border-top:1px solid var(--app-border);padding:16px}.dashboard-layout__time-selector{position:absolute;top:8px;left:8px;right:8px;transform:none;max-width:calc(100% - 16px);overflow-x:auto}.dashboard-layout__provenance{bottom:auto;top:342px;max-width:calc(100% - 20px)}.dashboard-layout__loading,.dashboard-layout__error{max-width:80%;text-align:center}}
@media(max-width:520px){.dashboard-layout__center{height:340px;min-height:340px}.dashboard-layout__provenance{top:306px;font-size:11px;padding:5px 8px}}
</style>
