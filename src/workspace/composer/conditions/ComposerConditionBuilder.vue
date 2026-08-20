<script setup lang="ts">
import { computed } from "vue"
import { AppIcon } from "@/components/ui/app-icon"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  allocConditionId,
  cloneConditionSet,
  conditionOperatorsForType,
  conditionOperator,
  validateConditionSet,
  type ConditionRule,
  type ConditionSet,
  type ConditionSourceOption,
} from "../../../../shared/conditions"
import ComposerConditionSourcePicker from "./ComposerConditionSourcePicker.vue"

const props = defineProps<{
  modelValue?: ConditionSet
  sources: readonly ConditionSourceOption[]
  disabled?: boolean
}>()

const emit = defineEmits<{ "update:modelValue": [value: ConditionSet | undefined] }>()

const groups = computed(() => props.modelValue?.groups ?? [])
const issues = computed(() => {
  if (!props.modelValue) return []
  const found = validateConditionSet(props.modelValue)
  props.modelValue.groups.forEach((group, groupIndex) => group.rules.forEach((rule, ruleIndex) => {
    const source = sourceForRule(rule)
    if (!source) {
      found.push({ path: ["groups", groupIndex, "rules", ruleIndex, "source"], message: "This source is not available in the current context." })
    } else if (!conditionOperatorsForType(source.valueType).some((operator) => operator.id === rule.operator)) {
      found.push({ path: ["groups", groupIndex, "rules", ruleIndex, "operator"], message: "Choose a comparison that works with this value." })
    }
  }))
  return found
})

function issueForRule(groupIndex: number, ruleIndex: number): string | null {
  return issues.value.find((issue) => issue.path[0] === "groups"
    && issue.path[1] === groupIndex
    && issue.path[2] === "rules"
    && issue.path[3] === ruleIndex)?.message ?? null
}

function ruleIssueId(groupIndex: number, ruleIndex: number): string | undefined {
  return issueForRule(groupIndex, ruleIndex) ? `condition-rule-${groupIndex}-${ruleIndex}-error` : undefined
}

function sourceKey(source: ConditionSourceOption | null | undefined): string {
  if (!source) return ""
  return encodeURIComponent(JSON.stringify(source.source))
}

function sourceForRule(rule: ConditionRule): ConditionSourceOption | null {
  return props.sources.find((source) => source.source.provider === rule.source.provider
    && source.source.path.join(".") === rule.source.path.join(".")) ?? null
}

function defaultValue(source: ConditionSourceOption): unknown {
  if (source.options?.length) return source.options[0]!.value
  if (source.valueType === "boolean") return true
  if (source.valueType === "number") return 0
  return ""
}

function newRule(): ConditionRule | null {
  const source = props.sources[0]
  if (!source) return null
  const operator = conditionOperatorsForType(source.valueType)[0]
  if (!operator) return null
  return {
    id: allocConditionId("rule"),
    source: structuredClone(source.source),
    operator: operator.id,
    ...(operator.needsValue ? { value: defaultValue(source) } : {}),
  }
}

function update(mutator: (next: ConditionSet) => void) {
  const next = cloneConditionSet(props.modelValue ?? { version: 1, groups: [] })
  mutator(next)
  next.groups = next.groups.filter((group) => group.rules.length > 0)
  emit("update:modelValue", next.groups.length ? next : undefined)
}

function addCondition() {
  const rule = newRule()
  if (!rule) return
  update((next) => next.groups.push({ id: allocConditionId("group"), rules: [rule] }))
}

function addRule(groupIndex: number) {
  const rule = newRule()
  if (!rule) return
  update((next) => next.groups[groupIndex]?.rules.push(rule))
}

function removeRule(groupIndex: number, ruleIndex: number) {
  update((next) => next.groups[groupIndex]?.rules.splice(ruleIndex, 1))
}

function setSource(groupIndex: number, ruleIndex: number, key: string) {
  const source = props.sources.find((item) => sourceKey(item) === key)
  if (!source) return
  update((next) => {
    const rule = next.groups[groupIndex]?.rules[ruleIndex]
    if (!rule) return
    const operator = conditionOperatorsForType(source.valueType)[0]
    rule.source = structuredClone(source.source)
    rule.operator = operator?.id ?? "equals"
    if (operator?.needsValue) rule.value = defaultValue(source)
    else delete rule.value
  })
}

function setOperator(groupIndex: number, ruleIndex: number, id: string) {
  update((next) => {
    const rule = next.groups[groupIndex]?.rules[ruleIndex]
    if (!rule) return
    rule.operator = id
    if (conditionOperator(id)?.needsValue) {
      if (rule.value === undefined) rule.value = defaultValue(sourceForRule(rule) ?? props.sources[0]!)
    } else delete rule.value
  })
}

function setValue(groupIndex: number, ruleIndex: number, value: unknown) {
  update((next) => {
    const rule = next.groups[groupIndex]?.rules[ruleIndex]
    if (rule) rule.value = value
  })
}

function valueInputType(source: ConditionSourceOption | null): string {
  if (source?.valueType === "number") return "number"
  if (source?.valueType === "date") return "date"
  return "text"
}
</script>

<template>
  <div class="space-y-3" data-aria-condition-builder>
    <div
      v-if="groups.length === 0"
      class="flex min-h-28 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border/70 bg-muted/20 px-4 py-5 text-center"
    >
      <div>
        <p class="text-sm font-medium text-foreground">Always shown</p>
        <p class="mt-1 text-xs leading-relaxed text-muted-foreground">Add a condition only when this should change.</p>
      </div>
      <Button type="button" size="sm" :disabled="disabled || sources.length === 0" @click="addCondition">
        <AppIcon name="plus" :size="13" aria-hidden="true" />
        Add condition
      </Button>
    </div>

    <template v-for="(group, groupIndex) in groups" :key="group.id">
      <div v-if="groupIndex > 0" class="flex items-center gap-2" aria-hidden="true">
        <span class="h-px flex-1 bg-border" />
        <span class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">or</span>
        <span class="h-px flex-1 bg-border" />
      </div>
      <fieldset class="space-y-2 rounded-md border border-dashed border-border/70 p-2.5">
        <legend class="px-1 text-[10px] font-medium text-muted-foreground">Match all</legend>
        <div
          v-for="(rule, ruleIndex) in group.rules"
          :key="rule.id"
          class="grid grid-cols-[minmax(0,1.15fr)_minmax(7.5rem,0.85fr)_minmax(0,1fr)_2rem] items-center gap-1.5"
        >
          <ComposerConditionSourcePicker
            :model-value="sourceKey(sourceForRule(rule) ?? sources[0]!)"
            :sources="sources"
            :disabled="disabled"
            :label="`Rule ${ruleIndex + 1}: choose what to check`"
            :described-by="ruleIssueId(groupIndex, ruleIndex)"
            @update:model-value="setSource(groupIndex, ruleIndex, $event)"
          />
          <Select
            :model-value="rule.operator"
            :disabled="disabled"
            @update:model-value="setOperator(groupIndex, ruleIndex, String($event))"
          >
            <SelectTrigger
              class="h-8 text-xs"
              :aria-label="`Rule ${ruleIndex + 1}: comparison`"
              :aria-describedby="ruleIssueId(groupIndex, ruleIndex)"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="operator in conditionOperatorsForType(sourceForRule(rule)?.valueType ?? 'unknown')"
                :key="operator.id"
                :value="operator.id"
              >
                {{ operator.label }}
              </SelectItem>
            </SelectContent>
          </Select>

          <template v-if="conditionOperator(rule.operator)?.needsValue">
            <label
              v-if="sourceForRule(rule)?.valueType === 'boolean'"
              class="flex h-8 items-center justify-between gap-2 rounded-sm border border-input bg-input px-2 text-xs"
            >
              <span>{{ rule.value ? "On" : "Off" }}</span>
              <Switch
                :model-value="Boolean(rule.value)"
                :disabled="disabled"
                :aria-label="`Rule ${ruleIndex + 1}: value`"
                :aria-describedby="ruleIssueId(groupIndex, ruleIndex)"
                @update:model-value="setValue(groupIndex, ruleIndex, Boolean($event))"
              />
            </label>
            <Select
              v-else-if="sourceForRule(rule)?.options?.length"
              :model-value="String(rule.value)"
              :disabled="disabled"
              @update:model-value="setValue(groupIndex, ruleIndex, sourceForRule(rule)?.valueType === 'boolean' ? String($event) === 'true' : $event)"
            >
              <SelectTrigger
                class="h-8 text-xs"
                :aria-label="`Rule ${ruleIndex + 1}: value`"
                :aria-describedby="ruleIssueId(groupIndex, ruleIndex)"
              ><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="option in sourceForRule(rule)?.options ?? []"
                  :key="String(option.value)"
                  :value="String(option.value)"
                >{{ option.label }}</SelectItem>
              </SelectContent>
            </Select>
            <div v-else>
              <Label :for="`condition-value-${rule.id}`" class="sr-only">Rule {{ ruleIndex + 1 }} value</Label>
              <Input
                :id="`condition-value-${rule.id}`"
                :type="valueInputType(sourceForRule(rule))"
                class="h-8 text-xs"
                :model-value="String(rule.value ?? '')"
                :disabled="disabled"
                :aria-describedby="ruleIssueId(groupIndex, ruleIndex)"
                @update:model-value="setValue(groupIndex, ruleIndex, sourceForRule(rule)?.valueType === 'number' ? Number($event) : String($event))"
              />
            </div>
          </template>
          <span v-else class="px-2 text-[10px] text-muted-foreground">No value</span>

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            class="size-8 cursor-pointer"
            :disabled="disabled"
            :aria-label="`Remove rule ${ruleIndex + 1}`"
            @click="removeRule(groupIndex, ruleIndex)"
          >
            <AppIcon name="trash" :size="13" aria-hidden="true" />
          </Button>
          <p
            v-if="issueForRule(groupIndex, ruleIndex)"
            :id="ruleIssueId(groupIndex, ruleIndex)"
            role="alert"
            class="col-span-4 px-1 text-[11px] text-destructive"
          >
            {{ issueForRule(groupIndex, ruleIndex) }}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" class="h-7 px-2 text-xs" :disabled="disabled" @click="addRule(groupIndex)">
          <AppIcon name="plus" :size="12" aria-hidden="true" />
          Add rule
        </Button>
      </fieldset>
    </template>

    <Button
      v-if="groups.length"
      type="button"
      variant="outline"
      size="sm"
      class="w-full border-dashed"
      :disabled="disabled"
      @click="addCondition"
    >
      <AppIcon name="plus" :size="13" aria-hidden="true" />
      Add alternative
    </Button>

    <div class="sr-only" role="status" aria-live="polite">
      {{ issues[0]?.message ?? (groups.length ? `${groups.length} condition groups` : "Always shown") }}
    </div>
  </div>
</template>
