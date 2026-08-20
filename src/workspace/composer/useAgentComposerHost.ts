import { onMounted, onUnmounted, watch, type Ref } from "vue"
import {
  agentToolFail,
  agentToolOk,
  type AgentRendererToolRequest,
  type AgentToolResult,
} from "../../../shared/agent"
import {
  formatAgentNodeNormalizationIssues,
  normalizeAgentNodeForInsert,
} from "../../../shared/composer/agentNodeNormalizer"
import {
  applyAgentComposerInsert,
  prepareAgentComposerInsert,
  type AgentComposerInsertResult,
} from "../../../shared/composer/agentComposerInsert"
import {
  applyAgentNodeClassUpdate,
  type AgentUpdateNodeClassesInput,
} from "../../../shared/composer/agentNodeClasses"
import {
  unsupportedUtilityClassesInNodes,
  unsupportedUtilityClassTokens,
} from "../../../shared/composer/agentUtilityClasses"
import type { ComposerFrameworkCapabilities } from "../../../shared/composer/frameworks"
import {
  bindCmsPropAtPath,
  bindCmsTextAtPath,
  unbindCmsPropAtPath,
  unbindCmsTextAtPath,
  upsertCmsCollectionQuery,
  unwrapCmsLoop,
  wrapNodeInCmsLoop,
  type CmsBindingFormat,
  type CmsFilterOperator,
} from "../../../shared/composer/cmsBindings"
import {
  applyNodeMotion,
  type NodeMotion,
} from "../../../shared/composer/motion"
import {
  deleteNodeAtPath,
  locateAtPath,
  pruneImports,
  reparentNodeAtPath,
  setPropAtPath,
  setTagAtPath,
  setTextAtPath,
  type InsertTarget,
} from "../../../shared/composer/mutate"
import {
  markerPathForNodeId,
  nodeAtMarkerPath,
} from "../../../shared/composer/paths"
import type {
  AstroDocumentModel,
  PropValue,
} from "../../../shared/composer/types"
import type { ConditionSet } from "../../../shared/conditions"
import { formatConditionSet } from "../../../shared/conditions"
import {
  addOtherwiseBranchAtPath,
  conditionalPathAtOrAbove,
  removeConditionAtPath,
  setConditionAtPath,
  wrapNodesInConditionAtPaths,
} from "../../../shared/composer/conditions"
import {
  onAgentRendererToolRequest,
  registerAgentRendererHost,
  resolveAgentRendererTool,
} from "@/lib/agent"
import type { ComposerBeacon } from "./selection/useComposerBeacon"

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function insertTarget(value: unknown): InsertTarget | null {
  const record = asRecord(value)
  if (!Number.isInteger(record.index) || Number(record.index) < 0) return null
  return {
    parentPath:
      typeof record.parentPath === "string" ? record.parentPath : null,
    index: Number(record.index),
  }
}

function resolveSelectionPath(
  nodes: AstroDocumentModel["nodes"],
  args: Record<string, unknown>,
): string | null {
  if (typeof args.path === "string" && args.path.trim()) {
    const path = args.path.trim()
    return nodeAtMarkerPath(nodes, path) ? path : null
  }
  if (typeof args.blockId === "string" && args.blockId.trim()) {
    const blockId = args.blockId.trim()
    const byId = markerPathForNodeId(nodes, blockId)
    if (byId) return byId
    return nodeAtMarkerPath(nodes, blockId) ? blockId : null
  }
  return null
}

export function useAgentComposerHost(input: {
  projectPath: Ref<string>
  editFile: Ref<string | null>
  editedMtimeMs: Ref<number | null>
  model: Ref<AstroDocumentModel | null>
  editable: Ref<boolean>
  dirty: Ref<boolean>
  framework: Ref<ComposerFrameworkCapabilities | null>
  knownDesignClasses: Ref<ReadonlySet<string>>
  beacon: ComposerBeacon
  mutateModel: (
    fn: (model: AstroDocumentModel) =>
      | { selectPath?: string | null; selectPaths?: string[]; ok?: boolean; reason?: string }
      | void,
    options?: { immediate?: boolean; coalesceKey?: string | null },
  ) => boolean
  flushSave: () => Promise<void>
}) {
  let unlisten: (() => void) | null = null
  let registrationTimer: ReturnType<typeof setTimeout> | null = null
  let registrationGeneration = 0
  let mounted = false
  let registeredProjectPath: string | null = null
  const registrationId = crypto.randomUUID()

  function clearRegistrationTimer() {
    if (!registrationTimer) return
    clearTimeout(registrationTimer)
    registrationTimer = null
  }

  function registerActiveHost(projectPath: string, attempt = 0) {
    clearRegistrationTimer()
    const generation = ++registrationGeneration
    void registerAgentRendererHost({
      projectPath,
      scope: "document",
      registrationId,
      active: true,
    })
      .then((result) => {
        if (result.registered) {
          if (
            mounted &&
            input.editFile.value &&
            input.model.value &&
            input.projectPath.value === projectPath &&
            generation === registrationGeneration
          ) {
            registeredProjectPath = projectPath
          } else {
            void registerAgentRendererHost({
              projectPath,
              scope: "document",
              registrationId,
              active: false,
            }).catch(() => undefined)
          }
          return
        }
        if (
          !mounted ||
          !input.editFile.value ||
          !input.model.value ||
          input.projectPath.value !== projectPath ||
          generation !== registrationGeneration ||
          attempt >= 7
        ) return
        registrationTimer = setTimeout(
          () => registerActiveHost(projectPath, attempt + 1),
          Math.min(100 * 2 ** attempt, 1_000),
        )
      })
      .catch(() => {
        if (
          !mounted ||
          !input.editFile.value ||
          !input.model.value ||
          input.projectPath.value !== projectPath ||
          generation !== registrationGeneration ||
          attempt >= 7
        ) return
        registrationTimer = setTimeout(
          () => registerActiveHost(projectPath, attempt + 1),
          Math.min(100 * 2 ** attempt, 1_000),
        )
      })
  }

  function unregisterHost(projectPath: string) {
    if (registeredProjectPath === projectPath) registeredProjectPath = null
    registrationGeneration += 1
    clearRegistrationTimer()
    void registerAgentRendererHost({
      projectPath,
      scope: "document",
      registrationId,
      active: false,
    }).catch(() => undefined)
  }

  async function execute(request: AgentRendererToolRequest): Promise<AgentToolResult> {
    if (request.projectPath !== input.projectPath.value) {
      return agentToolFail("NO_OPEN_DOCUMENT", "The active Composer belongs to another project.")
    }
    const args = asRecord(request.args)
    const expectedFile = typeof args.__expectedFile === "string"
      ? args.__expectedFile
      : null
    const expectedMtimeMs = typeof args.__expectedMtimeMs === "number"
      ? args.__expectedMtimeMs
      : null

    if (expectedFile && expectedFile !== input.editFile.value) {
      return agentToolFail("CONFLICT", "The open Composer document changed during the agent run.", {
        suggestedFix: "Retry against the currently open document.",
      })
    }
    if (
      expectedMtimeMs !== null &&
      input.editedMtimeMs.value !== null &&
      expectedMtimeMs !== input.editedMtimeMs.value
    ) {
      return agentToolFail("CONFLICT", "The Composer document revision changed during the agent run.", {
        suggestedFix: "Refresh the live document context and retry.",
      })
    }
    if (!input.model.value || !input.editFile.value) {
      return agentToolFail("NO_OPEN_DOCUMENT", "No document is open in Composer.")
    }
    if (!input.editable.value) {
      return agentToolFail("DOCUMENT_NOT_EDITABLE", "The open document is in read-only fallback mode.")
    }
    if (request.toolName === "select_block") {
      const path = resolveSelectionPath(input.model.value.nodes, args)
      if (!path) {
        return agentToolFail(
          "NOT_FOUND",
          `Composer node not found: ${String(args.path || args.blockId || "(missing)")}`,
        )
      }
      input.beacon.illuminate(path, {
        occurrence: typeof args.occurrence === "number" ? args.occurrence : 0,
        source: "api",
      })
      return agentToolOk({ selectedPath: path })
    }
    const explicitPath = typeof args.path === "string"
      ? args.path
      : typeof args.blockId === "string"
        ? resolveSelectionPath(input.model.value.nodes, { blockId: args.blockId }) ?? ""
        : ""
    const mutateExisting = (
      mutate: (model: AstroDocumentModel) =>
        | { selectPath?: string | null; selectPaths?: string[]; ok?: boolean; reason?: string }
        | void,
    ) => {
      if (!explicitPath || !nodeAtMarkerPath(input.model.value!.nodes, explicitPath)) return false
      return input.mutateModel(mutate, { immediate: true })
    }
    if (request.toolName === "aria_get_node_condition") {
      if (!explicitPath) return agentToolFail("NOT_FOUND", "Composer node not found.")
      const path = conditionalPathAtOrAbove(input.model.value, explicitPath)
      if (!path) return agentToolOk({ path: null, managed: false, summary: "Always shown" })
      const node = locateAtPath(input.model.value.nodes, path)?.node
      if (node?.kind !== "conditional") return agentToolFail("NOT_FOUND", "Condition not found.")
      return agentToolOk({
        path,
        managed: Boolean(node.condition),
        condition: node.condition ?? null,
        expression: node.test,
        mode: node.mode,
        summary: node.condition ? formatConditionSet(node.condition) : "Custom condition — edit in Code",
      })
    }
    let changed = false
    if (request.toolName === "aria_set_node_condition") {
      const condition = args.condition as ConditionSet
      changed = mutateExisting((model) => {
        const existingPath = conditionalPathAtOrAbove(model, explicitPath)
        if (existingPath) {
          const result = setConditionAtPath(model, existingPath, condition)
          if (!result.ok || args.otherwise !== true) return result
          const node = locateAtPath(model.nodes, existingPath)?.node
          return node?.kind === "conditional" && node.mode !== "ternary"
            ? addOtherwiseBranchAtPath(model, existingPath)
            : result
        }
        const result = wrapNodesInConditionAtPaths(model, [explicitPath], explicitPath, condition)
        if (!result.ok || args.otherwise !== true || !result.selectPath) return result
        const wrappedPath = conditionalPathAtOrAbove(model, result.selectPath)
        return wrappedPath ? addOtherwiseBranchAtPath(model, wrappedPath) : result
      })
    } else if (request.toolName === "aria_remove_node_condition") {
      changed = mutateExisting((model) => {
        const path = conditionalPathAtOrAbove(model, explicitPath)
        return path
          ? removeConditionAtPath(model, path, args.keep === "otherwise" || args.keep === "both" ? args.keep : "shown")
          : { ok: false, selectPath: explicitPath, reason: "This node is not inside a condition." }
      })
    } else if (request.toolName === "aria_mutate_node") {
      const operation = String(args.operation ?? "")
      changed = mutateExisting((model) => {
        if (operation === "set_text") return setTextAtPath(model, explicitPath, String(args.value ?? ""))
        if (operation === "set_tag") return setTagAtPath(model, explicitPath, String(args.value ?? ""))
        if (operation === "set_prop") return setPropAtPath(model, explicitPath, String(args.propName), args.value as PropValue)
        if (operation === "remove_prop") return setPropAtPath(model, explicitPath, String(args.propName), undefined)
        return { ok: false, selectPath: explicitPath, reason: "Unsupported mutation" }
      })
    } else if (request.toolName === "aria_update_node_classes") {
      const classInput: AgentUpdateNodeClassesInput = {
        classes: Array.isArray(args.classes)
          ? args.classes.filter((item): item is string => typeof item === "string")
          : undefined,
        add: Array.isArray(args.add)
          ? args.add.filter((item): item is string => typeof item === "string")
          : undefined,
        remove: Array.isArray(args.remove)
          ? args.remove.filter((item): item is string => typeof item === "string")
          : undefined,
        classNames:
          args.classNames && typeof args.classNames === "object" && !Array.isArray(args.classNames)
            ? (args.classNames as AgentUpdateNodeClassesInput["classNames"])
            : undefined,
      }
      const currentNode = locateAtPath(input.model.value.nodes, explicitPath)?.node
      if (
        !currentNode ||
        (currentNode.kind !== "element" &&
          currentNode.kind !== "component" &&
          currentNode.kind !== "slot" &&
          currentNode.kind !== "raw")
      ) {
        return agentToolFail("INVALID_INPUT", "Classes require an element or component.")
      }
      const proposed = applyAgentNodeClassUpdate(currentNode.props, classInput)
      if (!proposed.ok) return agentToolFail("INVALID_INPUT", proposed.reason)
      const unsupported = unsupportedUtilityClassTokens(
        proposed.tokens,
        input.framework.value,
        input.knownDesignClasses.value,
      )
      if (unsupported.length) {
        return agentToolFail(
          "INVALID_INPUT",
          `Utility classes are not enabled for this project: ${unsupported.join(", ")}.`,
          {
            suggestedFix: "Create custom CSS with aria_create_class, then apply those class names. Do not use Tailwind or UnoCSS tokens unless document.utilityStyles.enabled is true.",
          },
        )
      }
      changed = mutateExisting((model) => {
        const location = locateAtPath(model.nodes, explicitPath)
        if (!location) return { ok: false, selectPath: explicitPath, reason: "Node not found" }
        const node = location.node
        if (
          node.kind !== "element" &&
          node.kind !== "component" &&
          node.kind !== "slot" &&
          node.kind !== "raw"
        ) {
          return { ok: false, selectPath: explicitPath, reason: "Classes require an element or component." }
        }
        const updated = applyAgentNodeClassUpdate(node.props, classInput)
        if (!updated.ok) {
          return { ok: false, selectPath: explicitPath, reason: updated.reason }
        }
        return setPropAtPath(model, explicitPath, updated.propName, updated.value)
      })
    } else if (
      request.toolName === "aria_update_node_motion" ||
      request.toolName === "update_node_motion"
    ) {
      const motion = asRecord(args.motion) as unknown as NodeMotion
      if (!motion || typeof motion.enabled !== "boolean") {
        return agentToolFail("INVALID_INPUT", "Provide a motion object with at least enabled.")
      }
      changed = mutateExisting((model) => {
        const location = locateAtPath(model.nodes, explicitPath)
        if (!location) return { ok: false, selectPath: explicitPath, reason: "Node not found" }
        const result = applyNodeMotion(location.node, motion)
        return {
          ok: result.ok,
          selectPath: explicitPath,
          reason: result.reason,
        }
      })
    } else if (request.toolName === "aria_attach_media_to_node") {
      const src = typeof args.src === "string"
        ? args.src.trim()
        : typeof args.assetPath === "string"
          ? args.assetPath.trim()
          : typeof args.assetId === "string"
            ? args.assetId.trim()
            : ""
      const alt = typeof args.alt === "string" ? args.alt : undefined
      if (!src) {
        return agentToolFail("INVALID_INPUT", "Provide src, assetPath, or assetId for the media attachment.")
      }
      changed = mutateExisting((model) => {
        const location = locateAtPath(model.nodes, explicitPath)
        if (!location) return { ok: false, selectPath: explicitPath, reason: "Node not found" }
        const node = location.node
        if (node.kind !== "element" && node.kind !== "component") {
          return { ok: false, selectPath: explicitPath, reason: "Media can only attach to elements or components." }
        }
        const tag = node.kind === "element" ? node.name.toLowerCase() : ""
        const propName = tag === "video" || tag === "source" ? "src" : tag === "a" ? "href" : "src"
        setPropAtPath(model, explicitPath, propName, { type: "string", value: src })
        if (alt !== undefined && (tag === "img" || !tag)) {
          setPropAtPath(model, explicitPath, "alt", { type: "string", value: alt })
        }
        return { ok: true, selectPath: explicitPath }
      })
    } else if (request.toolName === "aria_bind_node_field") {
      const field = typeof args.field === "string" ? args.field.trim() : ""
      const mode = args.mode === "entry" ? "entry" : "context"
      const unbind = args.unbind === true
      const target =
        args.target === "text"
          ? "text"
          : args.target && typeof args.target === "object" && !Array.isArray(args.target)
            && typeof (args.target as { prop?: unknown }).prop === "string"
            ? { prop: String((args.target as { prop: string }).prop).trim() }
            : null
      if (!explicitPath) {
        return agentToolFail("INVALID_INPUT", "Provide path or blockId for the bind target.")
      }
      if (unbind) {
        const queryId = typeof args.queryId === "string" ? args.queryId.trim() : undefined
        changed = mutateExisting((model) => {
          if (target === "text") return unbindCmsTextAtPath(model, explicitPath, queryId)
          if (target && "prop" in target && target.prop) {
            return unbindCmsPropAtPath(model, explicitPath, target.prop, queryId)
          }
          return { ok: false, reason: "Provide target: \"text\" or { prop }." }
        })
      } else {
        if (!field) {
          return agentToolFail("INVALID_INPUT", "Provide field for the CMS binding.")
        }
        const format = (
          typeof args.format === "string" ? args.format : "plain"
        ) as CmsBindingFormat
        changed = mutateExisting((model) => {
          let variable =
            typeof args.contextVariable === "string" ? args.contextVariable.trim() : ""
          if (mode === "entry") {
            const collection =
              typeof args.collection === "string" ? args.collection.trim() : ""
            const entrySlug =
              typeof args.entrySlug === "string" ? args.entrySlug.trim() : ""
            if (!collection || !entrySlug) {
              return {
                ok: false,
                reason: "entry mode requires collection and entrySlug.",
              }
            }
            const queryId =
              typeof args.queryId === "string" && args.queryId.trim()
                ? args.queryId.trim()
                : `${explicitPath.replace(/[^a-zA-Z0-9_-]+/g, "-")}-entry`
            const query = upsertCmsCollectionQuery(model, {
              id: queryId,
              collection,
              entrySlug,
            })
            variable = query.variable
          }
          if (!variable) {
            return { ok: false, reason: "Provide contextVariable or use mode: \"entry\"." }
          }
          const binding = { contextVariable: variable, field, format }
          if (target === "text") return bindCmsTextAtPath(model, explicitPath, binding)
          if (target && "prop" in target && target.prop) {
            return bindCmsPropAtPath(model, explicitPath, target.prop, binding)
          }
          return { ok: false, reason: "Provide target: \"text\" or { prop }." }
        })
      }
    } else if (request.toolName === "aria_set_container_loop") {
      if (!explicitPath) {
        return agentToolFail("INVALID_INPUT", "Provide path or blockId for the loop target.")
      }
      const operation = args.operation === "unwrap" ? "unwrap" : "wrap"
      changed = mutateExisting((model) => {
        if (operation === "unwrap") {
          const queryId = typeof args.queryId === "string" ? args.queryId.trim() : undefined
          return unwrapCmsLoop(model, explicitPath, queryId)
        }
        const collection =
          typeof args.collection === "string" ? args.collection.trim() : ""
        if (!collection) {
          return { ok: false, reason: "wrap requires collection." }
        }
        const queryId =
          typeof args.queryId === "string" && args.queryId.trim()
            ? args.queryId.trim()
            : `${explicitPath.replace(/[^a-zA-Z0-9_-]+/g, "-")}-loop`
        const filters = Array.isArray(args.filters)
          ? args.filters
              .filter((item): item is Record<string, unknown> =>
                Boolean(item) && typeof item === "object" && !Array.isArray(item),
              )
              .map((item) => ({
                field: String(item.field ?? ""),
                operator: String(item.operator ?? "equals") as CmsFilterOperator,
                value: item.value as string | number | boolean | undefined,
              }))
              .filter((item) => item.field)
          : []
        const sort =
          args.sort && typeof args.sort === "object" && !Array.isArray(args.sort)
            ? {
                field: String((args.sort as { field?: unknown }).field ?? ""),
                direction:
                  (args.sort as { direction?: unknown }).direction === "desc"
                    ? ("desc" as const)
                    : ("asc" as const),
              }
            : undefined
        return wrapNodeInCmsLoop(model, explicitPath, {
          id: queryId,
          collection,
          entryVariable:
            typeof args.entryVariable === "string" && args.entryVariable.trim()
              ? args.entryVariable.trim()
              : "entry",
          filters,
          sort: sort?.field ? sort : undefined,
          limit:
            typeof args.limit === "number" && Number.isFinite(args.limit)
              ? Math.max(1, Math.floor(args.limit))
              : undefined,
        })
      })
    } else if (request.toolName === "aria_delete_node") {
      changed = mutateExisting((model) => deleteNodeAtPath(model, explicitPath))
    } else if (request.toolName === "aria_move_node") {
      const target = insertTarget(args.target)
      changed = Boolean(target) && mutateExisting((model) => reparentNodeAtPath(model, explicitPath, target!))
    } else if (request.toolName === "aria_replace_node") {
      const normalized = normalizeAgentNodeForInsert(args.node)
      if (!normalized.ok) {
        return agentToolFail(
          "INVALID_INPUT",
          "Provide a valid replacement Composer node.",
          { suggestedFix: formatAgentNodeNormalizationIssues(normalized.issues) },
        )
      }
      const replacement = normalized.node
      changed = mutateExisting((model) => {
        const location = locateAtPath(model.nodes, explicitPath)
        if (!location) return { ok: false, selectPath: explicitPath, reason: "Node not found" }
        location.list.splice(location.index, 1, replacement)
        pruneImports(model)
        return { ok: true, selectPath: explicitPath }
      })
    } else if (
      request.toolName !== "insert_nodes" &&
      request.toolName !== "aria_insert_nodes" &&
      request.toolName !== "insert_designed_section"
    ) {
      return agentToolFail("NOT_FOUND", `Unsupported Composer tool: ${request.toolName}`)
    } else {
      const supplied = request.toolName === "insert_designed_section"
        ? [args.node]
        : Array.isArray(args.nodes)
          ? args.nodes
          : []
      const prepared = prepareAgentComposerInsert(supplied)
      if (!prepared.ok) {
        return agentToolFail("INVALID_INPUT", prepared.message, {
          suggestedFix: prepared.suggestedFix,
        })
      }
      const unsupported = unsupportedUtilityClassesInNodes({
        nodes: prepared.nodes,
        framework: input.framework.value,
        knownCustomClasses: input.knownDesignClasses.value,
      })
      if (unsupported.length) {
        return agentToolFail(
          "INVALID_INPUT",
          `Utility classes are not enabled for this project: ${unsupported.join(", ")}.`,
          {
            suggestedFix: "Create custom CSS with aria_create_class, apply those class names to the node tree, and retry the insert. Do not use Tailwind or UnoCSS tokens unless document.utilityStyles.enabled is true.",
          },
        )
      }
      const explicitTarget = args.target === undefined ? undefined : insertTarget(args.target)
      if (args.target !== undefined && !explicitTarget) {
        return agentToolFail("INVALID_INPUT", "The insert target is invalid.", {
          suggestedFix: "Use a current path from the Composer Layers outline, or omit target to use safe placement.",
        })
      }
      const selected = input.beacon.selectedPath.value
      const insertResult: { value?: AgentComposerInsertResult } = {}
      changed = input.mutateModel(
        (model) => {
          insertResult.value = applyAgentComposerInsert({
            model,
            nodes: prepared.nodes,
            target: explicitTarget ?? undefined,
            selectedPath: selected,
          })
          return insertResult.value
        },
        { immediate: true },
      )
      if (!changed) {
        return agentToolFail("INVALID_INPUT", insertResult.value?.reason ?? "The nodes cannot be inserted at that location.", {
          suggestedFix: "Use a current path from the Composer Layers outline, or omit target to use safe placement.",
        })
      }
      try {
        await input.flushSave()
      } catch (error) {
        return agentToolFail("UNSAVED_CHANGES", "The Composer mutation could not be saved.", {
          suggestedFix: error instanceof Error ? error.message : String(error),
        })
      }
      return agentToolOk({
        changed: true,
        file: input.editFile.value,
        mtimeMs: input.editedMtimeMs.value,
        dirty: input.dirty.value,
        selectedPaths: [...input.beacon.selections.value],
        placement: insertResult.value?.placement,
      })
    }
    if (!changed) {
      return agentToolFail("INVALID_INPUT", "The nodes cannot be inserted at that location.")
    }
    try {
      await input.flushSave()
    } catch (error) {
      return agentToolFail("UNSAVED_CHANGES", "The Composer mutation could not be saved.", {
        suggestedFix: error instanceof Error ? error.message : String(error),
      })
    }
    return agentToolOk({
      changed: true,
      file: input.editFile.value,
      mtimeMs: input.editedMtimeMs.value,
      dirty: input.dirty.value,
      selectedPaths: [...input.beacon.selections.value],
    })
  }

  async function handleRequest(request: AgentRendererToolRequest) {
    if (request.projectPath !== input.projectPath.value) return
    const result = await execute(request)
    await resolveAgentRendererTool({
      requestId: request.requestId,
      projectPath: request.projectPath,
      result,
    }).catch(() => undefined)
  }

  onMounted(() => {
    mounted = true
    unlisten = onAgentRendererToolRequest((request) => {
      if (request.toolName === "open_in_composer") return
      void handleRequest(request)
    })
    if (input.editFile.value && input.model.value) {
      registerActiveHost(input.projectPath.value)
    }
  })

  watch(
    [input.projectPath, () => Boolean(input.editFile.value && input.model.value)],
    ([next, hasDocument], [previous, hadDocument]) => {
      if (hadDocument && previous && (!hasDocument || previous !== next)) {
        unregisterHost(previous)
      }
      if (
        mounted &&
        hasDocument &&
        next &&
        (!hadDocument || previous !== next)
      ) {
        registerActiveHost(next)
      }
    },
  )

  onUnmounted(() => {
    mounted = false
    unlisten?.()
    unlisten = null
    unregisterHost(input.projectPath.value)
  })
}
