import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { useState, useEffect } from 'react';
import { X, Calendar } from 'lucide-react-native';
import { scale, verticalScale } from '@/utils/responsive';
import { SPACING, FONT_SIZES } from '@/constants/sizes';
import { THEME } from '@/constants/theme';

interface DatePickerProps {
  value: string;
  onChange: (date: string) => void;
  placeholder?: string;
}

export default function DatePicker({ value, onChange, placeholder = 'JJ/MM/AAAA' }: DatePickerProps) {
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [selectedDay, setSelectedDay] = useState<number>(1);
  const [selectedMonth, setSelectedMonth] = useState<number>(1);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());

  useEffect(() => {
    if (value) {
      const parts = value.split('-');
      if (parts.length === 3) {
        setSelectedYear(parseInt(parts[0]));
        setSelectedMonth(parseInt(parts[1]));
        setSelectedDay(parseInt(parts[2]));
      }
    }
  }, [value]);

  const formatDisplayDate = (dateStr: string) => {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
  };

  const handleConfirm = () => {
    const formattedDate = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`;
    onChange(formattedDate);
    setIsModalVisible(false);
  };

  const months = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
  ];

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 30 }, (_, i) => currentYear - i);
  const days = Array.from({ length: 31 }, (_, i) => i + 1);

  return (
    <>
      <TouchableOpacity
        style={styles.inputContainer}
        onPress={() => setIsModalVisible(true)}
        activeOpacity={0.7}
      >
        <Text style={[styles.inputText, !value && styles.placeholder]}>
          {value ? formatDisplayDate(value) : placeholder}
        </Text>
        <Calendar size={20} color="#8791A1" strokeWidth={2} />
      </TouchableOpacity>

      <Modal
        visible={isModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Sélectionner une date</Text>
              <TouchableOpacity onPress={() => setIsModalVisible(false)}>
                <X size={24} color="#3F4A5A" strokeWidth={2} />
              </TouchableOpacity>
            </View>

            <View style={styles.pickersContainer}>
              <View style={styles.pickerColumn}>
                <Text style={styles.pickerLabel}>Jour</Text>
                <ScrollView style={styles.picker} showsVerticalScrollIndicator={false}>
                  {days.map((day) => (
                    <TouchableOpacity
                      key={day}
                      style={[
                        styles.pickerItem,
                        selectedDay === day && styles.pickerItemSelected
                      ]}
                      onPress={() => setSelectedDay(day)}
                    >
                      <Text style={[
                        styles.pickerItemText,
                        selectedDay === day && styles.pickerItemTextSelected
                      ]}>
                        {day}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <View style={styles.pickerColumn}>
                <Text style={styles.pickerLabel}>Mois</Text>
                <ScrollView style={styles.picker} showsVerticalScrollIndicator={false}>
                  {months.map((month, index) => (
                    <TouchableOpacity
                      key={month}
                      style={[
                        styles.pickerItem,
                        selectedMonth === index + 1 && styles.pickerItemSelected
                      ]}
                      onPress={() => setSelectedMonth(index + 1)}
                    >
                      <Text style={[
                        styles.pickerItemText,
                        selectedMonth === index + 1 && styles.pickerItemTextSelected
                      ]}>
                        {month}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <View style={styles.pickerColumn}>
                <Text style={styles.pickerLabel}>Année</Text>
                <ScrollView style={styles.picker} showsVerticalScrollIndicator={false}>
                  {years.map((year) => (
                    <TouchableOpacity
                      key={year}
                      style={[
                        styles.pickerItem,
                        selectedYear === year && styles.pickerItemSelected
                      ]}
                      onPress={() => setSelectedYear(year)}
                    >
                      <Text style={[
                        styles.pickerItemText,
                        selectedYear === year && styles.pickerItemTextSelected
                      ]}>
                        {year}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setIsModalVisible(false)}
              >
                <Text style={styles.cancelButtonText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton]}
                onPress={handleConfirm}
              >
                <Text style={styles.confirmButtonText}>Confirmer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: scale(100),
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  inputText: {
    fontSize: FONT_SIZES.base,
    color: '#3F4A5A',
  },
  placeholder: {
    color: '#8791A1',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: scale(16),
    width: '100%',
    maxWidth: scale(400),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  modalTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
    color: '#3F4A5A',
  },
  pickersContainer: {
    flexDirection: 'row',
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  pickerColumn: {
    flex: 1,
  },
  pickerLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: '#3F4A5A',
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  picker: {
    height: verticalScale(200),
    backgroundColor: '#F9FAFB',
    borderRadius: scale(8),
  },
  pickerItem: {
    paddingVertical: verticalScale(12),
    paddingHorizontal: SPACING.sm,
    alignItems: 'center',
  },
  pickerItemSelected: {
    backgroundColor: THEME.accent,
    marginHorizontal: SPACING.xs,
    borderRadius: scale(6),
  },
  pickerItemText: {
    fontSize: FONT_SIZES.sm,
    color: '#3F4A5A',
  },
  pickerItemTextSelected: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  modalActions: {
    flexDirection: 'row',
    gap: SPACING.md,
    padding: SPACING.lg,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  modalButton: {
    flex: 1,
    paddingVertical: SPACING.md,
    borderRadius: scale(100),
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#F3F4F6',
  },
  confirmButton: {
    backgroundColor: THEME.accent,
  },
  cancelButtonText: {
    fontSize: FONT_SIZES.base,
    fontWeight: '600',
    color: '#3F4A5A',
  },
  confirmButtonText: {
    fontSize: FONT_SIZES.base,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
