<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import { toast } from "vue-sonner"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { AppIcon } from "@/components/ui/app-icon"
import { confirm } from "@/composables/useConfirm"
import {
  type AgentSettings,
  type AgentSkill,
} from "../../../../shared/agent"
import { getAgentSettings, patchAgentSettings } from "@/lib/agent"
import AgentInferenceSettings from "./AgentInferenceSettings.vue"

type AgentSettingsTab = "agent" | "skills"

const props = defineProps<{
  projectPath: string
}>()

const form = ref<AgentSettings | null>(null)
const saving = ref(false)
const activeSettingsTab = ref<AgentSettingsTab>("agent")
const openSkillId = ref<string | null>(null)

const maxSkillsReached = computed(() => (form.value?.skills.length ?? 0) >= 8)

async function load(): Promise<void> {
  form.value = await getAgentSettings(props.projectPath)
}

onMounted(() => {
  void load()
})

watch(
  () => props.projectPath,
  () => void load(),
)

function onInferenceUpdated(settings: AgentSettings): void {
  form.value = settings
}

async function saveAgent(patch: Parameters<typeof patchAgentSettings>[1]) {
  if (!form.value) return
  saving.value = true
  try {
    form.value = await patchAgentSettings(props.projectPath, patch)
    toast.success("Agent settings saved")
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Failed to save agent settings",
    )
    await load()
  } finally {
    saving.value = false
  }
}

function skillName(skill: AgentSkill, index: number): string {
  return skill.name.trim() || `Skill ${index + 1}`
}

function normalizeSkills(skills: AgentSkill[]): AgentSkill[] {
  return skills
    .map((skill, index) => ({
      id: skill.id,
      name: skill.name.trim() || `Skill ${index + 1}`,
      instructions: skill.instructions.trim(),
    }))
    .filter((skill) => skill.instructions.length > 0)
}

async function saveSkills(): Promise<void> {
  if (!form.value) return
  await saveAgent({ skills: normalizeSkills(form.value.skills) })
}

function addSkill(): void {
  if (!form.value || maxSkillsReached.value) return
  const skill: AgentSkill = {
    id: crypto.randomUUID(),
    name: "",
    instructions: "",
  }
  form.value = {
    ...form.value,
    skills: [...form.value.skills, skill],
  }
  openSkillId.value = skill.id
}

async function duplicateSkill(index: number): Promise<void> {
  if (!form.value || maxSkillsReached.value) return
  const skill = form.value.skills[index]
  if (!skill) return
  const copy: AgentSkill = {
    ...skill,
    id: crypto.randomUUID(),
    name: `${skillName(skill, index)} (copy)`.slice(0, 80),
  }
  form.value = {
    ...form.value,
    skills: [
      ...form.value.skills.slice(0, index + 1),
      copy,
      ...form.value.skills.slice(index + 1),
    ],
  }
  openSkillId.value = copy.id
  await saveSkills()
}

async function removeSkill(index: number): Promise<void> {
  if (!form.value) return
  const removed = form.value.skills[index]
  const ok = await confirm({
    title: "Remove skill?",
    description: "This skill will no longer be available to the agent.",
    confirmLabel: "Remove",
    cancelLabel: "Cancel",
    destructive: true,
  })
  if (!ok) return
  form.value = {
    ...form.value,
    skills: form.value.skills.filter((_, skillIndex) => skillIndex !== index),
  }
  if (openSkillId.value === removed?.id) openSkillId.value = null
  await saveSkills()
}

async function moveSkill(index: number, direction: -1 | 1): Promise<void> {
  if (!form.value) return
  const targetIndex = index + direction
  if (targetIndex < 0 || targetIndex >= form.value.skills.length) return
  const next = [...form.value.skills]
  const [skill] = next.splice(index, 1)
  if (!skill) return
  next.splice(targetIndex, 0, skill)
  form.value = { ...form.value, skills: next }
  await saveSkills()
}
</script>

<template>
  <div v-if="form" class="min-w-0 space-y-0 bg-background">
    <Teleport defer to="#settings-tab-actions">
      <Button
        v-if="activeSettingsTab === 'skills'"
        type="button"
        :disabled="maxSkillsReached"
        @click="addSkill"
      >
        <AppIcon name="plus" />
        Add skill
      </Button>
    </Teleport>

    <div
      class="sticky top-0 z-10 flex h-12 shrink-0 items-stretch gap-1 border-y border-dashed border-border bg-background px-7"
      role="tablist"
      aria-label="Aria Engineer"
    >
      <Button
        type="button"
        size="tab"
        role="tab"
        :aria-selected="activeSettingsTab === 'agent'"
        :variant="activeSettingsTab === 'agent' ? 'tab-active' : 'tab'"
        @click="activeSettingsTab = 'agent'"
      >
        Agent
      </Button>
      <Button
        type="button"
        size="tab"
        role="tab"
        :aria-selected="activeSettingsTab === 'skills'"
        :variant="activeSettingsTab === 'skills' ? 'tab-active' : 'tab'"
        @click="activeSettingsTab = 'skills'"
      >
        Skills
      </Button>
    </div>

    <div class="px-10 py-7">
      <div class="mx-auto max-w-3xl space-y-7 pb-8">
        <AgentInferenceSettings
          v-if="activeSettingsTab === 'agent'"
          :project-path="projectPath"
          :form="form"
          :can-edit="true"
          :saving="saving"
          @updated="onInferenceUpdated"
        />

        <section v-if="activeSettingsTab === 'skills'" class="space-y-3">
          <div>
            <h4 class="m-0 text-sm font-medium">Skills</h4>
            <p
              class="max-w-sm text-xs leading-relaxed text-balance text-muted-foreground"
            >
              Reusable instruction packs the agent can follow. Up to 8 skills.
            </p>
          </div>

          <div class="grid gap-2 rounded-sm border border-border bg-card/30 p-2">
            <p
              v-if="form.skills.length === 0"
              class="px-1 py-2 text-xs text-muted-foreground"
            >
              No skills yet. Add one to teach the agent a repeatable workflow.
            </p>

            <div v-else class="grid gap-2">
              <Collapsible
                v-for="(skill, index) in form.skills"
                :key="skill.id"
                :open="openSkillId === skill.id"
                class="grid gap-0 rounded-sm border border-border/50 bg-card/30"
                @update:open="openSkillId = $event ? skill.id : null"
              >
                <div
                  class="flex min-w-0 items-center justify-between gap-2 px-2 py-1.5"
                >
                  <CollapsibleTrigger as-child>
                    <button type="button" class="min-w-0 flex-1 text-left">
                      <span class="block truncate text-xs text-foreground">
                        {{ skillName(skill, index) }}
                      </span>
                    </button>
                  </CollapsibleTrigger>
                  <div class="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      class="size-7"
                      :disabled="index === 0"
                      aria-label="Move up"
                      @click="moveSkill(index, -1)"
                    >
                      <AppIcon name="chevronUp" class="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      class="size-7"
                      :disabled="index === form.skills.length - 1"
                      aria-label="Move down"
                      @click="moveSkill(index, 1)"
                    >
                      <AppIcon name="chevronDown" class="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      class="size-7"
                      :disabled="maxSkillsReached"
                      aria-label="Duplicate"
                      @click="duplicateSkill(index)"
                    >
                      <AppIcon name="duplicate" class="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      class="size-7 hover:text-destructive"
                      aria-label="Remove"
                      @click="removeSkill(index)"
                    >
                      <AppIcon name="trash" class="size-3.5" />
                    </Button>
                  </div>
                </div>

                <CollapsibleContent
                  class="border-t border-dashed border-border/50 p-3"
                >
                  <div class="grid gap-3">
                    <Input
                      v-model="skill.name"
                      placeholder="Skill name"
                      @blur="saveSkills"
                    />
                    <Textarea
                      v-model="skill.instructions"
                      rows="6"
                      class="resize-y border-border/50 bg-input hover:bg-background"
                      placeholder="Instructions the agent should follow for this skill…"
                      @blur="saveSkills"
                    />
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
