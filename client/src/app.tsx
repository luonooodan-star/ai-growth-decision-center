/* eslint-disable @lark-apaas/require-app-container */
import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import Layout from './components/Layout';
import GrowthDecisionPage from './pages/growth-decision/GrowthDecisionPage';
import ProductOverviewPage from './pages/growth-decision/ProductOverviewPage';
import MetricLibraryPage from './pages/growth-decision/MetricLibraryPage';
import SkillIterationPage from './pages/growth-decision/SkillIterationPage';
import PaidGrowthPage from './pages/growth-decision/PaidGrowthPage';
import MetaOperationsPage from './pages/growth-decision/MetaOperationsPage';
import AdAdjustmentPage from './pages/growth-decision/AdAdjustmentPage';

const RoutesComponent = () => {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<ProductOverviewPage />} />
        <Route path="data" element={<PaidGrowthPage />} />
        <Route path="adjustments" element={<AdAdjustmentPage />} />
        <Route path="operations" element={<MetaOperationsPage />} />
        <Route path="products/:productId" element={<GrowthDecisionPage />} />
        <Route path="metrics" element={<MetricLibraryPage />} />
        <Route
          path="experiments"
          element={<Navigate to="/operations" replace />}
        />
        <Route path="skills" element={<SkillIterationPage />} />
      </Route>
      <Route path="*" element={<ProductOverviewPage />} />
    </Routes>
  );
};

export default RoutesComponent;
