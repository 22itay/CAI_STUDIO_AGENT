import {
  CheckStudioUpgradeStatusResponse,
  GetAssetDataRequest,
  GetAssetDataResponse,
  GetParentProjectDetailsRequest,
  GetParentProjectDetailsResponse,
  DownloadTemporaryFileRequest,
  HealthCheckResponse,
} from '@/studio/proto/agent_studio';

import { apiSlice } from '../api/apiSlice';

export const crossCuttingApi = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getAssetData: builder.query<GetAssetDataResponse, GetAssetDataRequest>({
      query: (request) => ({
        url: '/grpc/getAssetData',
        method: 'POST',
        body: request,
      }),
    }),
    getParentProjectDetails: builder.query<
      GetParentProjectDetailsResponse,
      GetParentProjectDetailsRequest
    >({
      query: (request) => ({
        url: '/grpc/getParentProjectDetails',
        method: 'POST',
        body: request,
      }),
    }),
    checkStudioUpgradeStatus: builder.query<CheckStudioUpgradeStatusResponse, void>({
      query: (request) => ({
        url: '/grpc/checkStudioUpgradeStatus',
        method: 'POST',
        body: {},
      }),
    }),
    upgradeStudio: builder.mutation<void, void>({
      query: (request) => ({
        url: '/grpc/upgradeStudio',
        method: 'POST',
        body: {},
      }),
    }),
    restartStudioApplication: builder.mutation<void, void>({
      query: (request) => ({
        url: '/grpc/restartStudioApplication',
        method: 'POST',
        body: {},
      }),
    }),
    healthCheck: builder.query<boolean, void>({
      query: () => ({
        url: '/grpc/healthCheck',
        method: 'POST',
        body: {},
        timeout: 500,
      }),
      transformResponse: (response: HealthCheckResponse) => {
        return response.message?.length > 0;
      },
      transformErrorResponse: () => {
        return false;
      },
    }),
  }),
});

export const {
  useGetAssetDataQuery,
  useGetParentProjectDetailsQuery,
  useCheckStudioUpgradeStatusQuery,
  useUpgradeStudioMutation,
  useRestartStudioApplicationMutation,
  useHealthCheckQuery,
} = crossCuttingApi;
