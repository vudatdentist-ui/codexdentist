export const optionalProviders = ["orthanc", "chatwoot", "novu", "medplum"] as const;
export type OptionalProvider = typeof optionalProviders[number];
export type OptionalProviderField = { key: string; label: string; secret: boolean; required: boolean };
export type OptionalProviderDefinition = { provider: OptionalProvider; name: string; description: string; fields: OptionalProviderField[] };
export type OptionalConnectionSummary = { id: string; clinicId: string | null; status: string; configured: boolean;
  verified: boolean; verifiedAt: string | null; hasReferences: boolean };
export type OptionalProviderWorkspace = { definition: OptionalProviderDefinition; clinics: Array<{id:string;name:string}>;
  canManageOrganization: boolean; isDemo: boolean; connections: OptionalConnectionSummary[] };
export function isOptionalProvider(value: string): value is OptionalProvider {
  return (optionalProviders as readonly string[]).includes(value);
}
