/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import expect from '@kbn/expect';
import { disableStreams, enableStreams, indexDocument, linkDashboard } from '../helpers/requests';
import {
  StreamsSupertestRepositoryClient,
  createStreamsRepositoryAdminClient,
} from '../helpers/repository_client';
import { DeploymentAgnosticFtrProviderContext } from '../../../ftr_provider_context';
import { loadDashboards, unloadDashboards } from '../helpers/dashboards';

export default function ({ getService }: DeploymentAgnosticFtrProviderContext) {
  const roleScopedSupertest = getService('roleScopedSupertest');
  const esClient = getService('es');

  let apiClient: StreamsSupertestRepositoryClient;

  const kibanaServer = getService('kibanaServer');

  const SPACE_ID = 'default';
  const ARCHIVES = [
    'src/platform/test/api_integration/fixtures/kbn_archiver/saved_objects/search.json',
    'src/platform/test/api_integration/fixtures/kbn_archiver/saved_objects/basic.json',
    'x-pack/test/api_integration/fixtures/kbn_archiver/streams/tagged_dashboard.json',
  ];

  const SEARCH_DASHBOARD_ID = 'b70c7ae0-3224-11e8-a572-ffca06da1357';
  const BASIC_DASHBOARD_ID = 'be3733a0-9efe-11e7-acb3-3dab96693fab';
  const BASIC_DASHBOARD_TITLE = 'Requests';
  const TAG_ID = '00ad6a46-6ac3-4f6c-892c-2f72c54a5e7d';

  async function unlinkDashboard(id: string) {
    const response = await apiClient.fetch(
      'DELETE /api/streams/{name}/dashboards/{dashboardId} 2023-10-31',
      {
        params: { path: { name: 'logs', dashboardId: id } },
      }
    );

    expect(response.status).to.be(200);
  }

  async function bulkLinkDashboard(...ids: string[]) {
    const response = await apiClient.fetch('POST /api/streams/{name}/dashboards/_bulk 2023-10-31', {
      params: {
        path: { name: 'logs' },
        body: {
          operations: ids.map((id) => {
            return {
              index: {
                id,
              },
            };
          }),
        },
      },
    });

    expect(response.status).to.be(200);
  }

  async function bulkUnlinkDashboard(...ids: string[]) {
    const response = await apiClient.fetch('POST /api/streams/{name}/dashboards/_bulk 2023-10-31', {
      params: {
        path: { name: 'logs' },
        body: {
          operations: ids.map((id) => {
            return {
              delete: {
                id,
              },
            };
          }),
        },
      },
    });

    expect(response.status).to.be(200);
  }

  describe('Asset links', function () {
    before(async () => {
      apiClient = await createStreamsRepositoryAdminClient(roleScopedSupertest);
      await enableStreams(apiClient);

      await indexDocument(esClient, 'logs', {
        '@timestamp': '2024-01-01T00:00:10.000Z',
        message: '2023-01-01T00:00:10.000Z error test',
      });
    });

    after(async () => {
      await disableStreams(apiClient);
    });

    describe('after linking a dashboard', () => {
      before(async () => {
        await loadDashboards(kibanaServer, ARCHIVES, SPACE_ID);

        await linkDashboard(apiClient, 'logs', SEARCH_DASHBOARD_ID);
      });

      after(async () => {
        await unlinkDashboard(SEARCH_DASHBOARD_ID);
        await unloadDashboards(kibanaServer, ARCHIVES, SPACE_ID);
      });

      it('lists the dashboard in the stream response', async () => {
        const response = await apiClient.fetch('GET /api/streams/{name} 2023-10-31', {
          params: { path: { name: 'logs' } },
        });

        expect(response.status).to.eql(200);

        expect(response.body.dashboards?.length).to.eql(1);
      });

      it('lists the dashboard in the dashboards get response', async () => {
        const response = await apiClient.fetch('GET /api/streams/{name}/dashboards 2023-10-31', {
          params: { path: { name: 'logs' } },
        });

        expect(response.status).to.eql(200);

        expect(response.body.dashboards.length).to.eql(1);
      });

      describe('after disabling', () => {
        before(async () => {
          // disabling and re-enabling streams wipes the asset links
          await disableStreams(apiClient);
          await enableStreams(apiClient);
        });

        it('dropped all dashboards', async () => {
          const response = await apiClient.fetch('GET /api/streams/{name}/dashboards 2023-10-31', {
            params: { path: { name: 'logs' } },
          });

          expect(response.status).to.eql(200);

          expect(response.body.dashboards.length).to.eql(0);
        });

        it('recovers on write and lists the linked dashboard ', async () => {
          await linkDashboard(apiClient, 'logs', SEARCH_DASHBOARD_ID);

          const response = await apiClient.fetch('GET /api/streams/{name}/dashboards 2023-10-31', {
            params: { path: { name: 'logs' } },
          });

          expect(response.status).to.eql(200);

          expect(response.body.dashboards.length).to.eql(1);
        });
      });

      describe('after deleting the dashboards', () => {
        before(async () => {
          await unloadDashboards(kibanaServer, ARCHIVES, SPACE_ID);
        });

        it('no longer lists the dashboard as a linked asset', async () => {
          const response = await apiClient.fetch('GET /api/streams/{name}/dashboards 2023-10-31', {
            params: { path: { name: 'logs' } },
          });

          expect(response.status).to.eql(200);

          expect(response.body.dashboards.length).to.eql(0);
        });
      });
    });

    describe('after using the bulk API', () => {
      before(async () => {
        await loadDashboards(kibanaServer, ARCHIVES, SPACE_ID);

        await bulkLinkDashboard(SEARCH_DASHBOARD_ID, BASIC_DASHBOARD_ID);
      });

      after(async () => {
        await bulkUnlinkDashboard(SEARCH_DASHBOARD_ID, BASIC_DASHBOARD_ID);
        await unloadDashboards(kibanaServer, ARCHIVES, SPACE_ID);
      });

      it('shows the linked dashboards', async () => {
        const response = await apiClient.fetch('GET /api/streams/{name}/dashboards 2023-10-31', {
          params: { path: { name: 'logs' } },
        });

        expect(response.body.dashboards.length).to.eql(2);
      });

      describe('after unlinking one dashboard', () => {
        before(async () => {
          await bulkUnlinkDashboard(SEARCH_DASHBOARD_ID);
        });

        it('only shows the remaining linked dashboard', async () => {
          const response = await apiClient.fetch('GET /api/streams/{name}/dashboards 2023-10-31', {
            params: { path: { name: 'logs' } },
          });

          expect(response.body.dashboards.length).to.eql(1);

          expect(response.body.dashboards[0].id).to.eql(BASIC_DASHBOARD_ID);
        });
      });
    });

    describe('on class stream that has not been touched yet', () => {
      before(async () => {
        await esClient.indices.createDataStream({
          name: 'logs-testlogs-default',
        });
      });
      after(async () => {
        await esClient.indices.deleteDataStream({
          name: 'logs-testlogs-default',
        });
      });
      it('does not list any dashboards but returns 200', async () => {
        const response = await apiClient.fetch('GET /api/streams/{name}/dashboards 2023-10-31', {
          params: { path: { name: 'logs-testlogs-default' } },
        });

        expect(response.status).to.eql(200);
        expect(response.body.dashboards.length).to.eql(0);
      });
    });

    describe('suggestions', () => {
      before(async () => {
        await loadDashboards(kibanaServer, ARCHIVES, SPACE_ID);

        await linkDashboard(apiClient, 'logs', SEARCH_DASHBOARD_ID);
      });

      after(async () => {
        await unlinkDashboard(SEARCH_DASHBOARD_ID);
        await unloadDashboards(kibanaServer, ARCHIVES, SPACE_ID);
      });

      describe('after creating multiple dashboards', () => {
        it('suggests dashboards to link', async () => {
          const response = await apiClient.fetch(
            'POST /internal/streams/{name}/dashboards/_suggestions',
            {
              params: { path: { name: 'logs' }, body: { tags: [] }, query: { query: '' } },
            }
          );

          expect(response.status).to.eql(200);
          expect(response.body.suggestions.length).to.eql(3);
        });

        it('filters suggested dashboards based on tags', async () => {
          const response = await apiClient.fetch(
            'POST /internal/streams/{name}/dashboards/_suggestions',
            {
              params: { path: { name: 'logs' }, body: { tags: [TAG_ID] }, query: { query: '' } },
            }
          );

          expect(response.status).to.eql(200);
          expect(response.body.suggestions.length).to.eql(1);
        });

        it('filters suggested dashboards based on the query', async () => {
          const response = await apiClient.fetch(
            'POST /internal/streams/{name}/dashboards/_suggestions',
            {
              params: {
                path: { name: 'logs' },
                body: { tags: [] },
                query: { query: BASIC_DASHBOARD_TITLE },
              },
            }
          );

          expect(response.status).to.eql(200);
          expect(response.body.suggestions.length).to.eql(1);

          expect(response.body.suggestions[0].id).to.eql(BASIC_DASHBOARD_ID);
        });
      });
    });
  });
}
