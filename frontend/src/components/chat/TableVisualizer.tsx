'use client';

import React, { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, AreaChart, Area
} from 'recharts';
import { BarChart3, Table as TableIcon, LineChart as LineIcon, AreaChart as AreaIcon } from 'lucide-react';

interface TableVisualizerProps {
  children: React.ReactNode;
}

export default function TableVisualizer({ children }: TableVisualizerProps) {
  const [viewMode, setViewMode] = useState<'table' | 'bar' | 'line' | 'area'>('table');

  // 데이터 파싱 로직
  const { headers, data, isChartable } = useMemo(() => {
    const rows: any[] = [];
    let headerList: string[] = [];
    
    // React children을 순회하며 데이터 추출
    // react-markdown의 table 구조는 [thead, tbody]
    React.Children.forEach(children, (child: any) => {
      if (!child) return;

      if (child.type === 'thead') {
        const tr = child.props.children;
        React.Children.forEach(tr.props.children, (th: any) => {
          headerList.push(String(th.props.children || ''));
        });
      }

      if (child.type === 'tbody') {
        React.Children.forEach(child.props.children, (tr: any) => {
          const rowData: any = {};
          React.Children.forEach(tr.props.children, (td: any, idx: number) => {
            const val = String(td.props.children || '');
            const key = headerList[idx] || `col${idx}`;
            
            // 숫자인지 확인 (콤마 제거 후)
            const numericVal = parseFloat(val.replace(/,/g, ''));
            rowData[key] = isNaN(numericVal) ? val : numericVal;
          });
          rows.push(rowData);
        });
      }
    });

    // 차트로 그릴 수 있는지 판단 (첫 번째 컬럼 제외하고 숫자인 컬럼이 하나라도 있으면)
    const numericCols = headerList.filter((h, idx) => {
      if (idx === 0) return false;
      return rows.some(r => typeof r[h] === 'number');
    });

    return { 
      headers: headerList, 
      data: rows, 
      isChartable: numericCols.length > 0 && rows.length > 0
    };
  }, [children]);

  if (!isChartable) {
    return (
      <div className="my-4 overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
          {children}
        </table>
      </div>
    );
  }

  const firstCol = headers[0];
  const chartCols = headers.slice(1).filter(h => data.some(r => typeof r[h] === 'number'));

  const renderChart = () => {
    const ChartComp = viewMode === 'line' ? LineChart : (viewMode === 'area' ? AreaChart : BarChart);
    const DataComp = viewMode === 'line' ? Line : (viewMode === 'area' ? Area : Bar);

    return (
      <div className="h-[300px] w-full mt-4 bg-white dark:bg-gray-900/50 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
        <ResponsiveContainer width="100%" height="100%">
          <ChartComp data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#88888820" />
            <XAxis 
              dataKey={firstCol} 
              fontSize={11} 
              tick={{ fill: '#888' }} 
              axisLine={false} 
              tickLine={false} 
            />
            <YAxis 
              fontSize={11} 
              tick={{ fill: '#888' }} 
              axisLine={false} 
              tickLine={false} 
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: 'rgba(255, 255, 255, 0.9)', 
                borderRadius: '8px', 
                border: 'none',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
              }} 
              itemStyle={{ fontSize: '12px' }}
            />
            <Legend iconType="circle" wrapperStyle={{ paddingTop: '10px', fontSize: '12px' }} />
            {chartCols.map((col, idx) => {
              const color = COLORS[idx % COLORS.length];
              if (viewMode === 'bar') {
                return (
                  <Bar
                    key={col}
                    dataKey={col}
                    fill={color}
                    radius={[4, 4, 0, 0]}
                  />
                );
              } else if (viewMode === 'line') {
                return (
                  <Line
                    key={col}
                    type="monotone"
                    dataKey={col}
                    stroke={color}
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                );
              } else {
                return (
                  <Area
                    key={col}
                    type="monotone"
                    dataKey={col}
                    fill={color}
                    stroke={color}
                    fillOpacity={0.3}
                  />
                );
              }
            })}
          </ChartComp>
        </ResponsiveContainer>
      </div>
    );
  };

  return (
    <div className="my-6 group relative">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
          <button
            onClick={() => setViewMode('table')}
            className={`p-1.5 rounded-md transition-all ${viewMode === 'table' ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-500' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
            title="표로 보기"
          >
            <TableIcon size={16} />
          </button>
          <button
            onClick={() => setViewMode('bar')}
            className={`p-1.5 rounded-md transition-all ${viewMode === 'bar' ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-500' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
            title="막대 차트"
          >
            <BarChart3 size={16} />
          </button>
          <button
            onClick={() => setViewMode('line')}
            className={`p-1.5 rounded-md transition-all ${viewMode === 'line' ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-500' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
            title="꺾은선 차트"
          >
            <LineIcon size={16} />
          </button>
          <button
            onClick={() => setViewMode('area')}
            className={`p-1.5 rounded-md transition-all ${viewMode === 'area' ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-500' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
            title="영역 차트"
          >
            <AreaIcon size={16} />
          </button>
        </div>
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-2">Data Intelligence</span>
      </div>

      {viewMode === 'table' ? (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
            {children}
          </table>
        </div>
      ) : (
        renderChart()
      )}
    </div>
  );
}

const COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444'];
