import React from 'react';
import { Route, Routes } from 'react-router-dom';

import Layout from './components/Layout';
import GrowthDecisionPage from './pages/growth-decision/GrowthDecisionPage';

const RoutesComponent = () => {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<GrowthDecisionPage />} />
      </Route>
      <Route path="*" element={<GrowthDecisionPage />} />
    </Routes>
  );
};

export default RoutesComponent;
