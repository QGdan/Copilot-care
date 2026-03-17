import {
  MedicalSearchProvider,
  MedicalSearchProviderContext,
  MedicalSearchProviderExecutionResult,
  PUBMED_SOURCE_ID,
} from './types';
import {
  searchPubMed,
  searchWhitelistedDuckDuckGo,
} from './providers';

class PubMedMedicalSearchProvider implements MedicalSearchProvider {
  public readonly id: string = PUBMED_SOURCE_ID;

  public isEnabled(context: MedicalSearchProviderContext): boolean {
    return context.allowedSourceIds.has(PUBMED_SOURCE_ID);
  }

  public async search(
    context: MedicalSearchProviderContext,
  ): Promise<MedicalSearchProviderExecutionResult> {
    const results = await searchPubMed({
      queries: context.retrievalQueries,
      limit: Math.max(
        context.limit,
        Math.min(context.config.pubMedRetMax, context.limit * 2),
      ),
      config: context.config,
      httpGetText: context.httpGetText,
    });

    return {
      providerId: this.id,
      results,
      droppedByPolicy: 0,
    };
  }
}

class DuckDuckGoWhitelistMedicalSearchProvider implements MedicalSearchProvider {
  public readonly id: string = 'DDG_WHITELIST';

  public isEnabled(context: MedicalSearchProviderContext): boolean {
    if (!context.config.duckDuckGoEnabled) {
      return false;
    }
    return context.allowedSources.some((source) => source.id !== PUBMED_SOURCE_ID);
  }

  public async search(
    context: MedicalSearchProviderContext,
  ): Promise<MedicalSearchProviderExecutionResult> {
    const allowedWebSources = context.allowedSources.filter(
      (source) => source.id !== PUBMED_SOURCE_ID,
    );
    const result = await searchWhitelistedDuckDuckGo({
      queries: context.retrievalQueries,
      limit: Math.max(context.limit * 3, 12),
      sources: allowedWebSources,
      config: context.config,
      httpGetText: context.httpGetText,
    });

    return {
      providerId: this.id,
      results: result.results,
      droppedByPolicy: result.droppedByPolicy,
    };
  }
}

function createDefaultMedicalSearchProviders(): MedicalSearchProvider[] {
  return [
    new PubMedMedicalSearchProvider(),
    new DuckDuckGoWhitelistMedicalSearchProvider(),
  ];
}

export {
  createDefaultMedicalSearchProviders,
  DuckDuckGoWhitelistMedicalSearchProvider,
  PubMedMedicalSearchProvider,
};
