/* eslint-disable @lark-apaas/require-app-container */
import React, { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';

const AuthorizationPage = lazy(
  () => import('./pages/growth-decision/AuthorizationPage'),
);
const PaidGrowthPage = lazy(
  () => import('./pages/growth-decision/PaidGrowthPage'),
);
const ProductOverviewPage = lazy(
  () => import('./pages/growth-decision/ProductOverviewPage'),
);
const GrowthDecisionPage = lazy(
  () => import('./pages/growth-decision/GrowthDecisionPage'),
);
const AdAdjustmentPage = lazy(
  () => import('./pages/growth-decision/AdAdjustmentPage'),
);
const MetaOperationsPage = lazy(
  () => import('./pages/growth-decision/MetaOperationsPage'),
);
const CreativeAnalysisPage = lazy(
  () => import('./pages/growth-decision/CreativeAnalysisPage'),
);
const MetricLibraryPage = lazy(
  () => import('./pages/growth-decision/MetricLibraryPage'),
);
const SkillIterationPage = lazy(
  () => import('./pages/growth-decision/SkillIterationPage'),
);
const RoasDataPage = lazy(() =>
  import('./pages/growth-decision/ReportPages').then(({ RoasDataPage }) => ({
    default: RoasDataPage,
  })),
);
const BehaviorDataPage = lazy(() =>
  import('./pages/growth-decision/ReportPages').then(
    ({ BehaviorDataPage }) => ({ default: BehaviorDataPage }),
  ),
);

const RoutesComponent = () => {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="authorization" element={<AuthorizationPage />} />
        <Route index element={<ProductOverviewPage />} />
        <Route path="data" element={<PaidGrowthPage />} />
        <Route path="roas" element={<RoasDataPage />} />
        <Route path="analysis/behavior" element={<BehaviorDataPage />} />
        <Route path="analysis" element={<CreativeAnalysisPage />} />
        <Route path="adjustments" element={<AdAdjustmentPage />} />
        <Route path="operations" element={<MetaOperationsPage />} />
        <Route path="products/:productId" element={<GrowthDecisionPage />} />
        <Route path="metrics" element={<MetricLibraryPage />} />
        <Route
          path="experiments"
          element={<Navigate to="/operations" replace />}
        />
        <Route path="skills" element={<SkillIterationPage />} />
        <Route path="*" element={<Navigate to="/data" replace />} />
      </Route>
    </Routes>
  );
};

export default RoutesComponent;
