import { z } from 'zod'

export const CHARACTER_BRIEF_SCHEMA_VERSION = 'character-brief/1' as const

const shortText = (max = 200) => z.string().trim().max(max).default('')
const longText = (max = 4000) => z.string().trim().max(max).default('')
const textList = (maxItems = 50, maxLength = 200) =>
  z.array(z.string().trim().min(1).max(maxLength)).max(maxItems).default([])

const relationshipEntrySchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    relation: z.string().trim().min(1).max(100),
    summary: z.string().trim().max(1000).default('')
  })
  .strict()

export const characterBriefContentSchema = z
  .object({
    schemaVersion: z.literal(CHARACTER_BRIEF_SCHEMA_VERSION),
    identity: z
      .object({
        fullName: shortText(100),
        givenName: shortText(100),
        aliases: textList(20, 100),
        codeNames: textList(20, 100),
        age: shortText(50),
        gender: shortText(50),
        species: shortText(100),
        birthday: shortText(50)
      })
      .strict()
      .default({}),
    social: z
      .object({
        occupation: shortText(100),
        affiliation: shortText(200),
        residence: shortText(200),
        origin: shortText(200),
        socialStatus: shortText(200),
        publicPersona: longText(1000)
      })
      .strict()
      .default({}),
    background: z
      .object({
        summary: longText(4000),
        timeline: textList(50, 500),
        secrets: textList(30, 500)
      })
      .strict()
      .default({}),
    appearance: z
      .object({
        height: shortText(50),
        build: shortText(100),
        skinTone: shortText(100),
        face: longText(1000),
        eyes: longText(1000),
        hair: longText(1000),
        outfit: longText(2000),
        palette: textList(20, 100),
        accessories: textList(20, 200),
        distinctiveFeatures: textList(20, 200),
        defaultPose: longText(1000),
        defaultExpression: longText(1000)
      })
      .strict()
      .default({}),
    personality: z
      .object({
        traits: textList(30, 100),
        values: textList(30, 200),
        fears: textList(20, 200),
        desires: textList(20, 200),
        speechStyle: longText(1000),
        habits: textList(30, 200),
        contradictions: textList(20, 300)
      })
      .strict()
      .default({}),
    behavior: z
      .object({
        bodyLanguage: longText(1000),
        idleBehavior: longText(1000),
        interactionStyle: longText(1000),
        taboos: textList(20, 200),
        comfortObjects: textList(20, 200)
      })
      .strict()
      .default({}),
    abilities: z
      .object({
        skills: textList(30, 200),
        powers: textList(30, 200),
        limitations: textList(30, 200)
      })
      .strict()
      .default({}),
    relationships: z
      .object({
        entries: z.array(relationshipEntrySchema).max(50).default([])
      })
      .strict()
      .default({}),
    arc: z
      .object({
        currentSituation: longText(2000),
        goals: textList(30, 200),
        conflicts: textList(30, 200),
        growthDirection: longText(1000)
      })
      .strict()
      .default({}),
    unknowns: z
      .object({
        factsToConfirm: textList(50, 300),
        openQuestions: textList(50, 300)
      })
      .strict()
      .default({}),
    notes: longText(8000)
  })
  .strict()

export type CharacterBriefContent = z.infer<typeof characterBriefContentSchema>

export function isMeaningfulCharacterBrief(content: CharacterBriefContent): boolean {
  const scalarValues = [
    content.identity.fullName,
    content.identity.givenName,
    content.identity.age,
    content.identity.gender,
    content.identity.species,
    content.social.occupation,
    content.social.affiliation,
    content.social.residence,
    content.social.origin,
    content.social.publicPersona,
    content.background.summary,
    content.appearance.height,
    content.appearance.build,
    content.appearance.face,
    content.appearance.eyes,
    content.appearance.hair,
    content.appearance.outfit,
    content.appearance.defaultPose,
    content.appearance.defaultExpression,
    content.personality.speechStyle,
    content.behavior.bodyLanguage,
    content.behavior.idleBehavior,
    content.behavior.interactionStyle,
    content.arc.currentSituation,
    content.arc.growthDirection,
    content.notes
  ]
  const listValues = [
    content.identity.aliases,
    content.identity.codeNames,
    content.background.timeline,
    content.background.secrets,
    content.appearance.palette,
    content.appearance.accessories,
    content.appearance.distinctiveFeatures,
    content.personality.traits,
    content.personality.values,
    content.personality.fears,
    content.personality.desires,
    content.personality.habits,
    content.personality.contradictions,
    content.behavior.taboos,
    content.behavior.comfortObjects,
    content.abilities.skills,
    content.abilities.powers,
    content.abilities.limitations,
    content.arc.goals,
    content.arc.conflicts,
    content.unknowns.factsToConfirm,
    content.unknowns.openQuestions
  ]
  return (
    scalarValues.some((value) => value.trim().length > 0) ||
    listValues.some((values) => values.length > 0) ||
    content.relationships.entries.length > 0
  )
}

export const CHARACTER_BRIEF_VERSION_SOURCE_KINDS = ['user', 'imported', 'derived_confirmed'] as const
export const characterBriefVersionSourceKindSchema = z.enum(CHARACTER_BRIEF_VERSION_SOURCE_KINDS)

export const createCharacterBriefVersionInputSchema = z
  .object({
    content: characterBriefContentSchema.refine(isMeaningfulCharacterBrief, {
      message: 'a meaningful character brief is required'
    }),
    parentVersionId: z
      .string()
      .regex(/^cbv_[0-9A-HJKMNP-TV-Z]{26}$/)
      .nullable()
      .optional(),
    expectedActiveBriefVersionId: z
      .string()
      .regex(/^cbv_[0-9A-HJKMNP-TV-Z]{26}$/)
      .nullable()
      .optional(),
    sourceKind: characterBriefVersionSourceKindSchema.default('user')
  })
  .strict()

export type CreateCharacterBriefVersionInput = z.infer<typeof createCharacterBriefVersionInputSchema>

export const characterBriefVersionSchema = z
  .object({
    id: z.string().regex(/^cbv_[0-9A-HJKMNP-TV-Z]{26}$/),
    characterId: z.string().regex(/^chr_[0-9A-HJKMNP-TV-Z]{26}$/),
    parentVersionId: z
      .string()
      .regex(/^cbv_[0-9A-HJKMNP-TV-Z]{26}$/)
      .nullable(),
    schemaVersion: z.literal(CHARACTER_BRIEF_SCHEMA_VERSION),
    content: characterBriefContentSchema,
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
    sourceKind: characterBriefVersionSourceKindSchema,
    createdAt: z.number().int().nonnegative()
  })
  .strict()

export type CharacterBriefVersion = z.infer<typeof characterBriefVersionSchema>
